// 云函数：每周次数刷新（建议由定时触发器每周六22:00执行）
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async () => {
  try {
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

    try {
      await db.collection('operation_logs').add({
        data: {
          type: 'weekly_auto_reset',
          count: tasks.length,
          reset_at: now,
          created_at: now
        }
      })
    } catch (logErr) {
      console.error('写入刷新日志失败', logErr)
    }

    return {
      success: true,
      count: tasks.length,
      resetAt: now
    }
  } catch (err) {
    console.error('weeklyReset error', err)
    return {
      success: false,
      message: err.message || '刷新失败'
    }
  }
}
