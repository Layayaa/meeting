// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

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

// 云函数入口函数
exports.main = async (event) => {
  const { date } = event

  try {
    const db = cloud.database()
    const now = new Date()

    // 自动把已到时间的 pending 更新成 completed
    const allRes = await db.collection('reservations').where({ date }).get()
    const completedIds = allRes.data
      .filter((item) => item.status === 'pending')
      .filter((item) => {
        const start = parseReservationDateTime(item.date, item.time_slot)
        return start && start <= now
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

    // 查询指定日期的可冲突预约（pending）
    const res = await db.collection('reservations')
      .where({
        date,
        status: 'pending'
      })
      .get()

    return {
      success: true,
      reservations: res.data
    }
  } catch (err) {
    console.error('获取预约失败', err)
    return {
      success: false,
      reservations: [],
      error: err.message
    }
  }
}
