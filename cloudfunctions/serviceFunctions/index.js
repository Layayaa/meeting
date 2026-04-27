// 云函数入口文件
const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const DEFAULT_SETTINGS = { weekly_default: 1, reset_time: '22:00', reset_day: 6 }
const DEFAULT_ROOMS = ['会议室A', '会议室B', '会议室C']

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 11) return digits
  if (digits.length === 13 && digits.startsWith('86')) return digits.slice(2)
  return digits
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return {
    password_salt: salt,
    password_hash: hashPassword(password, salt)
  }
}

function getDefaultPasswordByPhone(phone) {
  const normalized = normalizePhone(phone)
  if (!/^1\d{10}$/.test(normalized)) return ''
  return normalized.slice(-6)
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

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function normalizeInt(v, fallback = 0) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

function normalizeRoomNames(roomNames) {
  const source = Array.isArray(roomNames) ? roomNames.slice(0, 10) : []
  const cleaned = source
    .map((name) => String(name || '').trim())
    .filter(Boolean)
  const unique = []
  cleaned.forEach((name) => {
    if (!unique.includes(name)) {
      unique.push(name)
    }
  })
  return unique.length > 0 ? unique : DEFAULT_ROOMS
}

function getWeekDefault(user, settings) {
  if (typeof settings.weekly_default === 'number' && settings.weekly_default > 0) {
    return settings.weekly_default
  }
  return 1
}

function calcRemainingCount(user, settings) {
  const weeklyDefault = getWeekDefault(user, settings)
  const extra = normalizeInt(user.extra_count, 0)
  const used = normalizeInt(user.used_count, 0)
  return Math.max(0, weeklyDefault + extra - used)
}

function getSlotStartMinute(timeSlot) {
  const [startTime] = String(timeSlot || '').split('-')
  const [hour, minute] = String(startTime || '').split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null
  }
  return hour * 60 + minute
}

function isSameOrAdjacentTimeSlot(a, b) {
  const ma = getSlotStartMinute(a)
  const mb = getSlotStartMinute(b)
  if (ma === null || mb === null) {
    return false
  }
  return Math.abs(ma - mb) <= 60
}

function mapReservationStatus(status) {
  if (status === 'pending') return '待使用'
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已取消'
  return status || '未知'
}

async function getSettings() {
  const settingsRes = await db.collection('settings').where({ key: 'weekly_settings' }).get()
  const settings = settingsRes.data[0] || DEFAULT_SETTINGS
  const rooms = normalizeRoomNames(settings.room_names)
  return {
    _id: settings._id,
    weekly_default: normalizeInt(settings.weekly_default, DEFAULT_SETTINGS.weekly_default),
    reset_time: settings.reset_time || DEFAULT_SETTINGS.reset_time,
    reset_day: typeof settings.reset_day === 'number' ? settings.reset_day : DEFAULT_SETTINGS.reset_day,
    rooms,
    room_names: rooms
  }
}

async function getUserByOpenid(openid) {
  const userRes = await db.collection('users').where({ openid }).get()
  return userRes.data[0] || null
}

async function getAdminInfoByOpenid(openid) {
  const user = await getUserByOpenid(openid)
  if (!user || !user.phone) {
    return { isAdmin: false, user }
  }
  const normalized = normalizePhone(user.phone)
  const res = await db.collection('admins').get()
  const isAdmin = res.data.some((item) => normalizePhone(item.phone) === normalized)
  return {
    isAdmin,
    user
  }
}

async function ensureOperationLogCollectionExists() {
  try {
    await db.createCollection('operation_logs')
  } catch (error) {
    if (error.errCode !== -1) {
      throw error
    }
  }
}

async function writeOperationLog(data) {
  try {
    await ensureOperationLogCollectionExists()
    await db.collection('operation_logs').add({ data: { ...data, created_at: new Date() } })
  } catch (error) {
    console.error('写入操作日志失败', error)
  }
}

async function refreshWeeklyCountsCore() {
  const usersRes = await db.collection('users').get()
  const now = new Date()
  const tasks = usersRes.data.map((user) => db.collection('users').doc(user._id).update({
    data: {
      used_count: 0,
      last_reset: now
    }
  }))
  if (tasks.length > 0) {
    await Promise.all(tasks)
  }
  return { updatedCount: tasks.length, resetAt: now }
}

async function validateUserCanReserve(user, settings, reservationPayload) {
  if (!user) {
    return { ok: false, message: '用户未绑定' }
  }
  if (user.status !== 'active') {
    return { ok: false, message: '账户已被禁用' }
  }
  const remaining = calcRemainingCount(user, settings)
  if (remaining <= 0) {
    return { ok: false, message: '本周预约次数已用完' }
  }
  const { date, room, time_slot } = reservationPayload
  if (!isValidTimeSlot(time_slot)) {
    return { ok: false, message: '时段仅支持08:00-22:00整点预约' }
  }
  const targetStart = parseReservationDateTime(date, time_slot)
  if (!targetStart) {
    return { ok: false, message: '预约时间无效' }
  }
  const now = new Date()
  if (targetStart <= now) {
    return { ok: false, message: '不可预约已过期时段' }
  }
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const maxDate = new Date(todayStart)
  maxDate.setDate(maxDate.getDate() + 6)
  const requestedDate = new Date(`${date}T00:00:00`)
  if (Number.isNaN(requestedDate.getTime()) || requestedDate < todayStart || requestedDate > maxDate) {
    return { ok: false, message: '仅支持预约未来7天内时段' }
  }
  const conflictRes = await db.collection('reservations').where({
    date,
    room,
    time_slot,
    status: 'pending'
  }).get()
  if (conflictRes.data.length > 0) {
    return { ok: false, message: '该时段已被预约' }
  }
  const myPendingRes = await db.collection('reservations').where({
    openid: user.openid,
    date,
    status: 'pending'
  }).get()
  const hasAdjacent = myPendingRes.data.some((item) => isSameOrAdjacentTimeSlot(item.time_slot, time_slot))
  if (hasAdjacent) {
    return { ok: false, message: '同一账号不能预约连续时段' }
  }
  return { ok: true }
}

async function reserveRoomCore({ openid, date, room, timeSlot, purpose }) {
  if (!date || !room || !timeSlot) {
    return { success: false, message: '缺少预约参数' }
  }
  const user = await getUserByOpenid(openid)
  const settings = await getSettings()
  const check = await validateUserCanReserve(user, settings, {
    date,
    room,
    time_slot: timeSlot
  })
  if (!check.ok) {
    return { success: false, message: check.message }
  }
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
  const addRes = await db.collection('reservations').add({ data: reservationData })
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
}

async function decorateReservations(reservations) {
  const now = new Date()
  return reservations.map((item) => {
    const start = parseReservationDateTime(item.date, item.time_slot)
    const canCancel = item.status === 'pending' && start && (start - now) / 1000 / 60 / 60 > 2
    return {
      ...item,
      statusText: mapReservationStatus(item.status),
      canCancel,
      cancelTip: canCancel ? '' : '已过取消时限'
    }
  })
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const action = event.action

  try {
    if (action === 'getMyReservations') {
      const user = await getUserByOpenid(openid)
      if (!user) {
        return { success: true, reservations: [] }
      }
      const res = await db.collection('reservations').where({ openid }).orderBy('created_at', 'desc').get()
      return { success: true, reservations: await decorateReservations(res.data) }
    }

    if (action === 'cancelReservation') {
      const { reservationId } = event
      if (!reservationId) {
        return { success: false, message: '缺少预约ID' }
      }
      const reservationRes = await db.collection('reservations').doc(reservationId).get()
      const reservation = reservationRes.data
      if (!reservation) {
        return { success: false, message: '预约记录不存在' }
      }
      if (reservation.openid !== openid) {
        return { success: false, message: '无权限取消该预约' }
      }
      if (reservation.status !== 'pending') {
        return { success: false, message: '该预约无法取消' }
      }
      const startDateTime = parseReservationDateTime(reservation.date, reservation.time_slot)
      const now = new Date()
      if (!startDateTime) {
        return { success: false, message: '预约时间无效' }
      }
      const diffHour = (startDateTime - now) / 1000 / 60 / 60
      if (diffHour <= 2) {
        return { success: false, message: '已过取消时限' }
      }
      await db.collection('reservations').doc(reservationId).update({
        data: {
          status: 'cancelled',
          cancelled_at: now,
          cancelled_by: 'user'
        }
      })
      if (reservation.user_id) {
        await db.collection('users').doc(reservation.user_id).update({
          data: {
            used_count: _.inc(-1)
          }
        })
      }
      return { success: true, message: '取消成功' }
    }

    if (action === 'getActivities') {
      const res = await db.collection('activities').orderBy('time', 'desc').get()
      return { success: true, activities: res.data }
    }

    if (action === 'getUsers') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const settings = await getSettings()
      const userRes = await db.collection('users').orderBy('created_at', 'desc').get()
      const users = userRes.data.map((user) => {
        const weeklyDefault = getWeekDefault(user, settings)
        const extra = normalizeInt(user.extra_count, 0)
        const used = normalizeInt(user.used_count, 0)
        return {
          ...user,
          weeklyDefault,
          extra_count: extra,
          used_count: used,
          remainingCount: Math.max(0, weeklyDefault + extra - used)
        }
      })
      return { success: true, users }
    }

    if (action === 'addUser') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const phone = String(event.phone || '').trim()
      const name = String(event.name || '').trim()
      const department = String(event.department || '').trim()
      if (!/^1\d{10}$/.test(phone)) {
        return { success: false, message: '手机号格式不正确' }
      }
      if (!name) {
        return { success: false, message: '请输入姓名' }
      }
      const exists = await db.collection('users').where({ phone }).get()
      if (exists.data.length > 0) {
        return { success: false, message: '手机号已存在' }
      }
      const settings = await getSettings()
      await db.collection('users').add({
        data: {
          phone,
          name,
          department,
          openid: '',
          status: 'inactive',
          weekly_default: settings.weekly_default,
          extra_count: 0,
          used_count: 0,
          created_at: new Date()
        }
      })
      return { success: true, message: '添加成功' }
    }

    if (action === 'updateUserExtraCount') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const { userId } = event
      const extraCount = normalizeInt(event.extraCount, 0)
      if (!userId) {
        return { success: false, message: '缺少用户ID' }
      }
      if (extraCount < 0) {
        return { success: false, message: '派发次数不能小于0' }
      }
      await db.collection('users').doc(userId).update({
        data: {
          extra_count: extraCount,
          updated_at: new Date()
        }
      })
      await writeOperationLog({
        type: 'grant_extra_count',
        operator_openid: openid,
        operator_phone: adminInfo.user.phone,
        target_user_id: userId,
        extra_count: extraCount
      })
      return { success: true, message: '派发成功' }
    }

    if (action === 'toggleUserStatus') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const { userId, status } = event
      if (!userId || !['active', 'disabled'].includes(status)) {
        return { success: false, message: '状态参数无效' }
      }
      await db.collection('users').doc(userId).update({
        data: {
          status,
          updated_at: new Date()
        }
      })
      await writeOperationLog({
        type: 'toggle_user_status',
        operator_openid: openid,
        operator_phone: adminInfo.user.phone,
        target_user_id: userId,
        status
      })
      return { success: true, message: '更新成功' }
    }

    if (action === 'resetUserPassword') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const { userId } = event
      if (!userId) {
        return { success: false, message: '缺少用户ID' }
      }
      const userRes = await db.collection('users').doc(userId).get()
      const user = userRes.data
      if (!user) {
        return { success: false, message: '用户不存在' }
      }
      const defaultPassword = getDefaultPasswordByPhone(user.phone)
      if (!defaultPassword) {
        return { success: false, message: '手机号无效，无法重置密码' }
      }
      await db.collection('users').doc(userId).update({
        data: {
          ...createPasswordRecord(defaultPassword),
          password: '',
          updated_at: new Date()
        }
      })
      await writeOperationLog({
        type: 'reset_user_password',
        operator_openid: openid,
        operator_phone: adminInfo.user.phone,
        target_user_id: userId
      })
      return { success: true, message: '重置成功，新密码为手机号后6位' }
    }

    if (action === 'getReservationsAdmin') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const { dateFrom, dateTo, room, userName } = event
      const query = {}
      if (dateFrom && dateTo) {
        query.date = _.gte(dateFrom).and(_.lte(dateTo))
      } else if (dateFrom) {
        query.date = _.gte(dateFrom)
      } else if (dateTo) {
        query.date = _.lte(dateTo)
      }
      if (room) {
        query.room = room
      }
      if (userName) {
        query.user_name = userName
      }
      const res = await db.collection('reservations').where(query).get()
      const sorted = res.data.sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? -1 : 1
        if (a.time_slot !== b.time_slot) return a.time_slot > b.time_slot ? 1 : -1
        return 0
      })
      return { success: true, reservations: await decorateReservations(sorted) }
    }

    if (action === 'forceCancelReservation') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const { reservationId } = event
      if (!reservationId) {
        return { success: false, message: '缺少预约ID' }
      }
      const reservationRes = await db.collection('reservations').doc(reservationId).get()
      const reservation = reservationRes.data
      if (!reservation) {
        return { success: false, message: '预约记录不存在' }
      }
      if (reservation.status !== 'pending') {
        return { success: false, message: '该预约不能强制取消' }
      }
      const now = new Date()
      await db.collection('reservations').doc(reservationId).update({
        data: {
          status: 'cancelled',
          cancelled_by_admin: true,
          cancelled_by: 'admin',
          cancelled_at: now
        }
      })
      if (reservation.user_id) {
        await db.collection('users').doc(reservation.user_id).update({
          data: {
            used_count: _.inc(-1)
          }
        })
      }
      await writeOperationLog({
        type: 'force_cancel_reservation',
        operator_openid: openid,
        operator_phone: adminInfo.user.phone,
        reservation_id: reservationId
      })
      return { success: true, message: '取消成功' }
    }

    if (action === 'reserveRoom') {
      return reserveRoomCore({
        openid,
        date: event.date,
        room: event.room,
        timeSlot: event.timeSlot,
        purpose: event.purpose
      })
    }

    if (action === 'completeReservationByTime') {
      const now = new Date()
      const today = formatDate(now)
      const todayRes = await db.collection('reservations').where({
        date: today,
        status: 'pending'
      }).get()
      const completedIds = todayRes.data
        .filter((item) => {
          const start = parseReservationDateTime(item.date, item.time_slot)
          if (!start) return false
          return start <= now
        })
        .map((item) => item._id)
      if (completedIds.length > 0) {
        await Promise.all(completedIds.map((id) => db.collection('reservations').doc(id).update({
          data: {
            status: 'completed',
            completed_at: now
          }
        })))
      }
      return { success: true, count: completedIds.length }
    }

    if (action === 'getSettings') {
      const settings = await getSettings()
      return { success: true, settings }
    }

    if (action === 'updateSettings') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const weeklyDefault = normalizeInt(event.weekly_default, DEFAULT_SETTINGS.weekly_default)
      const resetTime = String(event.reset_time || DEFAULT_SETTINGS.reset_time)
      const resetDay = normalizeInt(event.reset_day, DEFAULT_SETTINGS.reset_day)
      const roomNames = normalizeRoomNames(event.room_names)
      if (weeklyDefault <= 0) {
        return { success: false, message: '默认次数必须大于0' }
      }
      if (!/^\d{2}:\d{2}$/.test(resetTime)) {
        return { success: false, message: '刷新时间格式应为HH:mm' }
      }
      if (resetDay < 0 || resetDay > 6) {
        return { success: false, message: '刷新周期参数错误' }
      }
      const settings = await getSettings()
      if (settings._id) {
        await db.collection('settings').doc(settings._id).update({
          data: {
            weekly_default: weeklyDefault,
            reset_time: resetTime,
            reset_day: resetDay,
            room_names: roomNames,
            updated_at: new Date()
          }
        })
      } else {
        await db.collection('settings').add({
          data: {
            key: 'weekly_settings',
            weekly_default: weeklyDefault,
            reset_time: resetTime,
            reset_day: resetDay,
            room_names: roomNames,
            created_at: new Date()
          }
        })
      }
      return { success: true, message: '保存成功' }
    }

    if (action === 'addActivity') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const { title, time, description, qr_code_url } = event
      if (!title || !time) {
        return { success: false, message: '请填写标题和时间' }
      }
      await db.collection('activities').add({
        data: {
          title,
          time,
          description: description || '',
          qr_code_url: qr_code_url || '',
          created_at: new Date()
        }
      })
      return { success: true, message: '发布成功' }
    }

    if (action === 'updateActivity') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const { activityId, title, time, description, qr_code_url } = event
      if (!activityId) {
        return { success: false, message: '缺少活动ID' }
      }
      await db.collection('activities').doc(activityId).update({
        data: {
          title,
          time,
          description: description || '',
          qr_code_url: qr_code_url || '',
          updated_at: new Date()
        }
      })
      return { success: true, message: '保存成功' }
    }

    if (action === 'deleteActivity') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const { activityId } = event
      if (!activityId) {
        return { success: false, message: '缺少活动ID' }
      }
      await db.collection('activities').doc(activityId).remove()
      return { success: true, message: '删除成功' }
    }

    if (action === 'refreshWeeklyCounts') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const { updatedCount, resetAt } = await refreshWeeklyCountsCore()
      await writeOperationLog({
        type: 'refresh_weekly_counts',
        operator_openid: openid,
        operator_phone: adminInfo.user.phone,
        count: updatedCount,
        reset_at: resetAt
      })
      return { success: true, count: updatedCount }
    }

    return { success: false, message: '未知操作' }
  } catch (err) {
    console.error('serviceFunctions error', err)
    return { success: false, message: err.message || '服务异常' }
  }
}
