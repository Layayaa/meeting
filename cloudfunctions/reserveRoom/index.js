// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const DEFAULT_SETTINGS = { weekly_default: 1 }

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

function isSameOrAdjacentTimeSlot(a, b) {
  const ma = getSlotStartMinute(a)
  const mb = getSlotStartMinute(b)
  if (ma === null || mb === null) return false
  return Math.abs(ma - mb) <= 60
}

function calcRemainingCount(user, settings) {
  const weeklyDefault = typeof user.weekly_default === 'number' && user.weekly_default > 0
    ? user.weekly_default
    : (settings.weekly_default || 1)
  const extra = Number(user.extra_count) || 0
  const used = Number(user.used_count) || 0
  return Math.max(0, weeklyDefault + extra - used)
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

    // 计算剩余次数
    const remainingCount = calcRemainingCount(user, settings)
    if (remainingCount <= 0) {
      return {
        success: false,
        message: '本周预约次数已用完'
      }
    }

    // 检查冲突
    const existingRes = await db.collection('reservations').where({
      date,
      room,
      time_slot: timeSlot,
      status: 'pending'
    }).get()
    if (existingRes.data.length > 0) {
      return {
        success: false,
        message: '该时段已被预约'
      }
    }

    // 同账号不能连续预约时段（同一天）
    const myPendingRes = await db.collection('reservations').where({
      openid,
      date,
      status: 'pending'
    }).get()
    const hasAdjacent = myPendingRes.data.some((item) => isSameOrAdjacentTimeSlot(item.time_slot, timeSlot))
    if (hasAdjacent) {
      return {
        success: false,
        message: '同一账号不能预约连续时段'
      }
    }

    // 创建预约记录
    const reservationData = {
      user_id: user._id,
      openid,
      user_name: user.name,
      user_phone: user.phone,
      date,
      room,
      time_slot: timeSlot,
      purpose: purpose || '',
      status: 'pending',
      created_at: new Date()
    }
    const addRes = await db.collection('reservations').add({
      data: reservationData
    })

    // 更新用户已使用次数
    await db.collection('users').doc(user._id).update({
      data: {
        used_count: _.inc(1)
      }
    })

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
