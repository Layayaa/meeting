// 云函数入口文件
const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const DEFAULT_SETTINGS = { weekly_default: 1 }
const LOCK_COLLECTION = 'reservation_locks'

function createReservationLockId(date, room, timeSlot) {
  return crypto
    .createHash('sha1')
    .update(`${date}|${room}|${timeSlot}`)
    .digest('hex')
}

function isDuplicateKeyError(error) {
  const message = String(error && (error.message || error.errMsg) || '')
  return message.includes('duplicate') || message.includes('already exists') || message.includes('E11000')
}

function isLockCollectionUnavailable(error) {
  const code = error && (error.errCode || error.code)
  const message = String(error && (error.message || error.errMsg) || '')
  return code === -501001 || code === -502005 || message.includes(LOCK_COLLECTION) || message.includes('collection')
}

function parseReservationDateTime(date, timeSlot) {
  const [startTime] = String(timeSlot || '').split('-')
  const [hour, minute] = String(startTime || '').split(':').map(Number)
  const dateTime = new Date(`${date}T00:00:00`)
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || Number.isNaN(dateTime.getTime())) {
    return null
  }
  dateTime.setHours(hour, minute, 0, 0)
  return dateTime
}

function isValidTimeSlot(timeSlot) {
  const [start, end] = String(timeSlot || '').split('-')
  if (!start || !end) return false
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if (![sh, sm, eh, em].every(Number.isFinite)) return false
  if (sm !== 0 || em !== 0) return false
  if (sh < 8 || eh > 22) return false
  if (eh - sh !== 1) return false
  return true
}

function getSlotStartMinute(timeSlot) {
  const [startTime] = String(timeSlot || '').split('-')
  const [hour, minute] = String(startTime || '').split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return hour * 60 + minute
}

function isAdjacentTimeSlot(a, b) {
  const ma = getSlotStartMinute(a)
  const mb = getSlotStartMinute(b)
  if (ma === null || mb === null) return false
  return Math.abs(ma - mb) === 60
}

function calcRemainingCount(user, settings) {
  const weeklyDefault = typeof settings.weekly_default === 'number' && settings.weekly_default > 0
    ? settings.weekly_default
    : 1
  const extra = Number(user.extra_count) || 0
  const used = Number(user.used_count) || 0
  return Math.max(0, weeklyDefault + extra - used)
}

async function createReservationInTransaction({ user, settings, openid, date, room, timeSlot, purpose }) {
  const lockId = createReservationLockId(date, room, timeSlot)
  const transaction = await db.startTransaction()

  try {
    try {
      await transaction.collection(LOCK_COLLECTION).add({
        data: {
          _id: lockId,
          date,
          room,
          time_slot: timeSlot,
          openid,
          status: 'pending',
          created_at: new Date()
        }
      })
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw error
      }
      if (!isLockCollectionUnavailable(error)) {
        throw error
      }
      console.warn('reservation lock skipped', error)
    }

    const conflictRes = await transaction.collection('reservations').where({
      date,
      room,
      time_slot: timeSlot,
      status: 'pending'
    }).get()
    if (conflictRes.data.length > 0) {
      throw new Error('该时段已被预约')
    }

    const latestUserRes = await transaction.collection('users').doc(user._id).get()
    const latestUser = latestUserRes.data
    if (!latestUser || latestUser.status !== 'active') {
      throw new Error('账户当前不可预约')
    }
    if (calcRemainingCount(latestUser, settings) <= 0) {
      throw new Error('本周预约次数已用完')
    }

    const myPendingRes = await transaction.collection('reservations').where({
      openid,
      date,
      status: 'pending'
    }).get()
    const hasAdjacent = myPendingRes.data.some((item) => isAdjacentTimeSlot(item.time_slot, timeSlot))
    if (hasAdjacent) {
      throw new Error('同一账号不能预约连续时段')
    }

    const addRes = await transaction.collection('reservations').add({
      data: {
        user_id: user._id,
        openid,
        user_name: user.name,
        user_phone: user.phone,
        date,
        room,
        time_slot: timeSlot,
        lock_id: lockId,
        purpose: purpose || '',
        status: 'pending',
        created_at: new Date()
      }
    })

    await transaction.collection('users').doc(user._id).update({
      data: {
        used_count: _.inc(1)
      }
    })

    await transaction.commit()
    return addRes
  } catch (error) {
    await transaction.rollback()
    throw error
  }
}

// 云函数入口函数
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { date, room, timeSlot, purpose } = event

  try {
    if (!date || !room || !timeSlot) {
      return {
        success: false,
        message: '预约信息不完整'
      }
    }
    if (!isValidTimeSlot(timeSlot)) {
      return {
        success: false,
        message: '时段仅支持08:00-22:00整点预约'
      }
    }

    // 获取用户
    const userRes = await db.collection('users').where({
      openid
    }).get()

    if (userRes.data.length === 0) {
      return {
        success: false,
        message: '用户未绑定'
      }
    }

    const user = userRes.data[0]

    // 检查用户状态
    if (user.status !== 'active') {
      return {
        success: false,
        message: '账户已被禁用'
      }
    }

    // 检查日期范围（未来7天内，含今天）
    const now = new Date()
    const targetStart = parseReservationDateTime(date, timeSlot)
    if (!targetStart) {
      return {
        success: false,
        message: '预约时间无效'
      }
    }
    if (targetStart <= now) {
      return {
        success: false,
        message: '不可预约已过期时段'
      }
    }
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const maxDate = new Date(todayStart)
    maxDate.setDate(maxDate.getDate() + 6)
    const requestDate = new Date(`${date}T00:00:00`)
    if (Number.isNaN(requestDate.getTime()) || requestDate < todayStart || requestDate > maxDate) {
      return {
        success: false,
        message: '仅支持预约未来7天内时段'
      }
    }

    // 获取系统设置
    const settingsRes = await db.collection('settings').where({
      key: 'weekly_settings'
    }).get()
    const settings = (settingsRes.data && settingsRes.data[0]) || DEFAULT_SETTINGS

    let addRes
    try {
      addRes = await createReservationInTransaction({
        user,
        settings,
        openid,
        date,
        room,
        timeSlot,
        purpose
      })
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return {
          success: false,
          message: '该时段已被预约'
        }
      }
      return {
        success: false,
        message: error.message || '预约失败，请重试'
      }
    }

    return {
      success: true,
      reservationId: addRes._id,
      message: '预约成功'
    }

  } catch (err) {
    console.error('预约失败', err)
    return {
      success: false,
      message: '预约失败，请重试'
    }
  }
}
