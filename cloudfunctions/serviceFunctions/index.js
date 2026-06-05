// 云函数入口文件
const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const DEFAULT_SETTINGS = {
  weekly_default: 1,
  reset_time: '22:00',
  reset_day: 6,
  contact_wechat: '',
  contact_email: '3963632979@qq.com',
  contact_qr_image: '/images/contact/oacend-wechat.jpg',
  contact_subject_hint: '项目名称+联系人姓名+电话'
}
const LOCK_COLLECTION = 'reservation_locks'
const DEFAULT_ROOM_IMAGES = [
  '/images/rooms/room-1.svg',
  '/images/rooms/room-2.svg',
  '/images/rooms/room-3.svg'
]

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

function verifyPassword(user, password) {
  if (user.password_hash && user.password_salt) {
    return hashPassword(password, user.password_salt) === user.password_hash
  }
  if (typeof user.password === 'string' && user.password.length > 0) {
    return user.password === password
  }
  return false
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

function getCurrentWeekRange() {
  const now = new Date()
  const start = new Date(now)
  const day = start.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  start.setDate(start.getDate() + diffToMonday)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)

  return {
    start,
    end,
    startText: formatDate(start),
    endText: formatDate(end)
  }
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

function normalizeRoomDetails(roomDetails, roomNames) {
  const names = normalizeRoomNames(roomNames)
  const source = Array.isArray(roomDetails) ? roomDetails : []
  const byName = {}
  source.forEach((item) => {
    const name = String((item && item.name) || '').trim()
    if (name) byName[name] = item
  })
  return names.map((name, index) => {
    const detail = byName[name] || source[index] || {}
    const capacity = normalizeInt(detail.capacity, index === 0 ? 8 : index === 1 ? 12 : 6)
    const equipmentText = String(detail.equipmentText || detail.equipment || '').trim()
    return {
      name,
      image: String(detail.image || DEFAULT_ROOM_IMAGES[index % DEFAULT_ROOM_IMAGES.length]),
      capacity: capacity > 0 ? capacity : 6,
      equipmentText: equipmentText || '投影仪、白板、视频会议'
    }
  })
}

function maskPhoneTail(phone) {
  const digits = normalizePhone(phone)
  return digits.length >= 4 ? digits.slice(-4) : '--'
}

async function fetchReservationsByDateRange(startText, endText) {
  const pageSize = 100
  let skip = 0
  const all = []

  while (true) {
    const res = await db.collection('reservations')
      .where({
        date: _.gte(startText).and(_.lte(endText))
      })
      .skip(skip)
      .limit(pageSize)
      .get()
    const batch = res.data || []
    all.push(...batch)
    if (batch.length < pageSize) break
    skip += pageSize
  }

  return all
}

function buildDashboardStats(reservations, settings, weekRange) {
  const effectiveReservations = reservations.filter((item) => item.status !== 'cancelled')
  const rooms = normalizeRoomNames(settings.room_names)
  const roomMap = new Map(rooms.map((room) => [room, 0]))
  const userMap = new Map()
  const slotMap = new Map()

  effectiveReservations.forEach((item) => {
    const room = item.room || '未设置会议室'
    roomMap.set(room, (roomMap.get(room) || 0) + 1)

    const userKey = item.user_id || item.openid || item.user_phone || item.user_name || 'unknown'
    const currentUser = userMap.get(userKey) || {
      name: item.user_name || '未知用户',
      phoneTail: maskPhoneTail(item.user_phone),
      count: 0
    }
    currentUser.count += 1
    userMap.set(userKey, currentUser)

    const slot = item.time_slot || '未设置时段'
    slotMap.set(slot, (slotMap.get(slot) || 0) + 1)
  })

  const total = effectiveReservations.length
  const roomUsage = Array.from(roomMap.entries())
    .map(([room, count]) => ({
      room,
      count,
      percent: total > 0 ? Math.round((count / total) * 100) : 0,
      widthStyle: `width: ${total > 0 ? Math.round((count / total) * 100) : 0}%;`
    }))
    .sort((a, b) => b.count - a.count)

  const activeUsers = Array.from(userMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const maxSlotCount = Math.max(1, ...Array.from(slotMap.values()))
  const peakSlots = Array.from(slotMap.entries())
    .map(([timeSlot, count]) => ({
      timeSlot,
      count,
      percent: Math.round((count / maxSlotCount) * 100),
      widthStyle: `width: ${Math.round((count / maxSlotCount) * 100)}%;`
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.timeSlot > b.timeSlot ? 1 : -1
    })
    .slice(0, 8)

  return {
    weekRange: {
      start: weekRange.startText,
      end: weekRange.endText
    },
    totalReservations: total,
    roomUsage,
    activeUsers,
    peakSlots,
    topRoomText: roomUsage[0] ? roomUsage[0].room : '--',
    topSlotText: peakSlots[0] ? peakSlots[0].timeSlot : '--'
  }
}

function buildTimeSlots() {
  const slots = []
  for (let hour = 8; hour < 22; hour++) {
    const start = `${String(hour).padStart(2, '0')}:00`
    const end = `${String(hour + 1).padStart(2, '0')}:00`
    slots.push(`${start}-${end}`)
  }
  return slots
}

function buildNextSevenDates() {
  const today = new Date()
  const weekNames = ['日', '一', '二', '三', '四', '五', '六']
  return Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() + index)
    const month = date.getMonth() + 1
    const day = date.getDate()
    return {
      date: formatDate(date),
      dayLabel: index === 0 ? '今天' : index === 1 ? '明天' : `周${weekNames[date.getDay()]}`,
      monthDay: `${month}/${day}`
    }
  })
}

function buildWeeklyAvailability(reservations, settings) {
  const rooms = normalizeRoomNames(settings.room_names)
  const totalRooms = rooms.length
  const dates = buildNextSevenDates()
  const slots = buildTimeSlots()
  const pendingReservations = reservations.filter((item) => item.status === 'pending')
  const now = new Date()

  const rows = slots.map((timeSlot) => ({
    timeSlot,
    cells: dates.map((dateItem) => {
      const occupiedRooms = pendingReservations
        .filter((item) => item.date === dateItem.date && item.time_slot === timeSlot)
        .map((item) => item.room)
        .filter(Boolean)
      const uniqueOccupiedRooms = Array.from(new Set(occupiedRooms))
      const availableRooms = rooms.filter((room) => !uniqueOccupiedRooms.includes(room))
      const occupiedCount = uniqueOccupiedRooms.length
      const slotStart = parseReservationDateTime(dateItem.date, timeSlot)
      const isExpired = !!slotStart && slotStart <= now
      const status = isExpired
        ? 'expired'
        : occupiedCount >= totalRooms
          ? 'full'
          : occupiedCount > 0
            ? 'partial'
            : 'free'
      const statusText = isExpired
        ? '过期'
        : occupiedCount >= totalRooms
          ? '已满'
          : occupiedCount > 0
            ? `${availableRooms.length}空`
            : '空闲'
      return {
        date: dateItem.date,
        timeSlot,
        status,
        className: `availability-cell ${status}`,
        statusText,
        occupiedCount,
        availableCount: isExpired ? 0 : availableRooms.length,
        totalRooms,
        availableRooms
      }
    })
  }))

  return {
    dates,
    slots,
    rows,
    rooms
  }
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

function isAdjacentTimeSlot(a, b) {
  const ma = getSlotStartMinute(a)
  const mb = getSlotStartMinute(b)
  if (ma === null || mb === null) {
    return false
  }
  return Math.abs(ma - mb) === 60
}

function mapReservationStatus(status) {
  if (status === 'pending') return '待使用'
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已取消'
  return status || '未知'
}

function mapFeedbackStatus(status) {
  if (status === 'pending') return '待回复'
  if (status === 'replied') return '已回复'
  return status || '未知'
}

async function getSettings() {
  const settingsRes = await db.collection('settings').where({ key: 'weekly_settings' }).get()
  const settings = settingsRes.data[0] || DEFAULT_SETTINGS
  const rooms = normalizeRoomNames(settings.room_names)
  const roomDetails = normalizeRoomDetails(settings.room_details, rooms)
  return {
    _id: settings._id,
    weekly_default: normalizeInt(settings.weekly_default, DEFAULT_SETTINGS.weekly_default),
    reset_time: settings.reset_time || DEFAULT_SETTINGS.reset_time,
    reset_day: typeof settings.reset_day === 'number' ? settings.reset_day : DEFAULT_SETTINGS.reset_day,
    rooms,
    room_names: rooms,
    room_details: roomDetails,
    contact_wechat: String(settings.contact_wechat || DEFAULT_SETTINGS.contact_wechat).trim(),
    contact_email: String(settings.contact_email || DEFAULT_SETTINGS.contact_email).trim(),
    contact_qr_image: String(settings.contact_qr_image || DEFAULT_SETTINGS.contact_qr_image).trim(),
    contact_subject_hint: String(settings.contact_subject_hint || DEFAULT_SETTINGS.contact_subject_hint).trim()
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
  const hasAdjacent = myPendingRes.data.some((item) => isAdjacentTimeSlot(item.time_slot, time_slot))
  if (hasAdjacent) {
    return { ok: false, message: '同一账号不能预约连续时段' }
  }
  return { ok: true }
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
  try {
    const createdReservation = await createReservationInTransaction({
      user,
      settings,
      openid,
      date,
      room,
      timeSlot,
      purpose
    })
    return {
      success: true,
      reservationId: createdReservation._id,
      message: '预约成功'
    }
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { success: false, message: '该时段已被预约' }
    }
    return { success: false, message: error.message || '预约失败，请重试' }
  }
}

async function cancelReservationInTransaction({ reservationId, reservation, cancelledBy, extraData = {} }) {
  const transaction = await db.startTransaction()
  const now = new Date()
  const lockId = reservation.lock_id || createReservationLockId(reservation.date, reservation.room, reservation.time_slot)

  try {
    const latestReservationRes = await transaction.collection('reservations').doc(reservationId).get()
    const latestReservation = latestReservationRes.data
    if (!latestReservation || latestReservation.status !== 'pending') {
      throw new Error('该预约无法取消')
    }

    await transaction.collection('reservations').doc(reservationId).update({
      data: {
        status: 'cancelled',
        cancelled_at: now,
        cancelled_by: cancelledBy,
        ...extraData
      }
    })

    if (latestReservation.user_id) {
      await transaction.collection('users').doc(latestReservation.user_id).update({
        data: {
          used_count: _.inc(-1)
        }
      })
    }

    try {
      await transaction.collection(LOCK_COLLECTION).doc(lockId).remove()
    } catch (error) {
      console.warn('release reservation lock failed', error)
    }

    await transaction.commit()
  } catch (error) {
    await transaction.rollback()
    throw error
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

function isNoticePublished(notice) {
  return notice && notice.status === 'published'
}

function formatNoticeSummary(notice) {
  return {
    ...notice,
    is_pinned: !!notice.is_pinned,
    status: notice.status || 'draft'
  }
}

function formatFeedbackSummary(item) {
  return {
    ...item,
    statusText: mapFeedbackStatus(item.status),
    content_summary: String(item.content || '').slice(0, 50)
  }
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
      await cancelReservationInTransaction({
        reservationId,
        reservation,
        cancelledBy: 'user'
      })
      return { success: true, message: '取消成功' }
    }

    if (action === 'getActivities') {
      const res = await db.collection('activities').orderBy('time', 'desc').get()
      return { success: true, activities: res.data }
    }

    if (action === 'submitFeedback') {
      const user = await getUserByOpenid(openid)
      if (!user) {
        return { success: false, message: '请先登录后再提交反馈' }
      }
      const content = String(event.content || '').trim()
      const images = Array.isArray(event.images) ? event.images.filter(Boolean).slice(0, 3) : []
      if (!content) {
        return { success: false, message: '请填写反馈内容' }
      }
      if (content.length > 500) {
        return { success: false, message: '反馈内容最多500字' }
      }
      const addRes = await db.collection('feedbacks').add({
        data: {
          openid,
          user_name: user.name || '用户',
          user_phone: user.phone || '',
          content,
          images,
          status: 'pending',
          admin_reply: '',
          replied_at: null,
          created_at: new Date(),
          updated_at: new Date()
        }
      })
      return { success: true, feedbackId: addRes._id, message: '感谢您的反馈' }
    }

    if (action === 'getMyFeedbacks') {
      const listRes = await db.collection('feedbacks')
        .where({ openid })
        .orderBy('created_at', 'desc')
        .get()
      const feedbacks = (listRes.data || []).map(formatFeedbackSummary)
      return { success: true, feedbacks }
    }

    if (action === 'getFeedbackDetail') {
      const feedbackId = String(event.feedbackId || '')
      if (!feedbackId) {
        return { success: false, message: '缺少反馈ID' }
      }
      const docRes = await db.collection('feedbacks').doc(feedbackId).get()
      const detail = docRes.data
      if (!detail) {
        return { success: false, message: '反馈记录不存在' }
      }
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin && detail.openid !== openid) {
        return { success: false, message: '无权限查看该反馈' }
      }
      return {
        success: true,
        feedback: {
          ...detail,
          statusText: mapFeedbackStatus(detail.status)
        }
      }
    }

    if (action === 'getFeedbacksAdmin') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const status = String(event.status || 'all')
      const query = {}
      if (status === 'pending' || status === 'replied') {
        query.status = status
      }
      const listRes = await db.collection('feedbacks')
        .where(query)
        .orderBy('created_at', 'desc')
        .get()
      const feedbacks = (listRes.data || []).map((item) => ({
        ...formatFeedbackSummary(item),
        content_summary: String(item.content || '').slice(0, 30)
      }))
      return { success: true, feedbacks }
    }

    if (action === 'replyFeedback') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const feedbackId = String(event.feedbackId || '')
      const reply = String(event.admin_reply || '').trim()
      if (!feedbackId) {
        return { success: false, message: '缺少反馈ID' }
      }
      if (!reply) {
        return { success: false, message: '请输入回复内容' }
      }
      if (reply.length > 500) {
        return { success: false, message: '回复内容最多500字' }
      }
      await db.collection('feedbacks').doc(feedbackId).update({
        data: {
          status: 'replied',
          admin_reply: reply,
          replied_at: new Date(),
          updated_at: new Date()
        }
      })
      return { success: true, message: '回复成功' }
    }

    if (action === 'getNotices') {
      const scope = String(event.scope || 'user')
      const baseQuery = scope === 'admin' ? {} : { status: 'published' }
      const listRes = await db.collection('notices')
        .where(baseQuery)
        .orderBy('is_pinned', 'desc')
        .orderBy('published_at', 'desc')
        .orderBy('created_at', 'desc')
        .get()
      const notices = (listRes.data || []).map(formatNoticeSummary)
      return { success: true, notices }
    }

    if (action === 'getNoticeDetail') {
      const noticeId = String(event.noticeId || '')
      if (!noticeId) {
        return { success: false, message: '缺少通知ID' }
      }
      const docRes = await db.collection('notices').doc(noticeId).get()
      const notice = docRes.data
      if (!notice) {
        return { success: false, message: '通知不存在' }
      }
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin && !isNoticePublished(notice)) {
        return { success: false, message: '通知未发布' }
      }
      return { success: true, notice: formatNoticeSummary(notice) }
    }

    if (action === 'saveNotice') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const noticeId = String(event.noticeId || '')
      const title = String(event.title || '').trim()
      const content = String(event.content || '').trim()
      const isPinned = !!event.is_pinned
      const status = event.status === 'published' ? 'published' : 'draft'
      if (!title) {
        return { success: false, message: '请输入通知标题' }
      }
      if (!content) {
        return { success: false, message: '请输入通知内容' }
      }
      const now = new Date()
      if (noticeId) {
        const updateData = {
          title,
          content,
          is_pinned: isPinned,
          status,
          updated_at: now
        }
        if (status === 'published') {
          updateData.published_at = now
        }
        await db.collection('notices').doc(noticeId).update({
          data: updateData
        })
        return { success: true, message: '保存成功', noticeId }
      }
      const addRes = await db.collection('notices').add({
        data: {
          title,
          content,
          is_pinned: isPinned,
          status,
          created_at: now,
          updated_at: now,
          published_at: status === 'published' ? now : null
        }
      })
      return { success: true, message: '保存成功', noticeId: addRes._id }
    }

    if (action === 'deleteNotice') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const noticeId = String(event.noticeId || '')
      if (!noticeId) {
        return { success: false, message: '缺少通知ID' }
      }
      await db.collection('notices').doc(noticeId).remove()
      return { success: true, message: '删除成功' }
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

    if (action === 'getDashboardStats') {
      const adminInfo = await getAdminInfoByOpenid(openid)
      if (!adminInfo.isAdmin) {
        return { success: false, message: '无权限' }
      }
      const settings = await getSettings()
      const weekRange = getCurrentWeekRange()
      const reservations = await fetchReservationsByDateRange(weekRange.startText, weekRange.endText)
      return {
        success: true,
        stats: buildDashboardStats(reservations, settings, weekRange)
      }
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

    if (action === 'changePassword') {
      const user = await getUserByOpenid(openid)
      if (!user) {
        return { success: false, message: '请先登录' }
      }
      const oldPassword = String(event.oldPassword || '')
      const newPassword = String(event.newPassword || '')
      if (oldPassword.length < 6) {
        return { success: false, message: '请输入当前密码' }
      }
      if (newPassword.length < 6) {
        return { success: false, message: '新密码至少6位' }
      }
      if (oldPassword === newPassword) {
        return { success: false, message: '新密码不能与原密码相同' }
      }
      if (!verifyPassword(user, oldPassword)) {
        return { success: false, message: '当前密码错误' }
      }
      await db.collection('users').doc(user._id).update({
        data: {
          ...createPasswordRecord(newPassword),
          password: '',
          updated_at: new Date()
        }
      })
      return { success: true, message: '密码修改成功' }
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
      await cancelReservationInTransaction({
        reservationId,
        reservation,
        cancelledBy: 'admin',
        extraData: {
          cancelled_by_admin: true
        }
      })
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

    if (action === 'getWeeklyAvailability') {
      const settings = await getSettings()
      const dates = buildNextSevenDates()
      const startText = dates[0].date
      const endText = dates[dates.length - 1].date
      const reservations = await fetchReservationsByDateRange(startText, endText)
      return {
        success: true,
        availability: buildWeeklyAvailability(reservations, settings)
      }
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
      const roomDetails = normalizeRoomDetails(event.room_details, roomNames)
      const contactWechat = String(event.contact_wechat || '').trim()
      const contactEmail = String(event.contact_email || '').trim()
      const contactQrImage = String(event.contact_qr_image || '').trim()
      const contactSubjectHint = String(event.contact_subject_hint || '').trim()
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
            room_details: roomDetails,
            contact_wechat: contactWechat,
            contact_email: contactEmail,
            contact_qr_image: contactQrImage,
            contact_subject_hint: contactSubjectHint,
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
            room_details: roomDetails,
            contact_wechat: contactWechat,
            contact_email: contactEmail,
            contact_qr_image: contactQrImage,
            contact_subject_hint: contactSubjectHint,
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
