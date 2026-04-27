// 云函数：初始化数据库集合
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

exports.main = async (event, context) => {
  try {
    const collections = ['users', 'admins', 'reservations', 'activities', 'settings', 'operation_logs']

    const results = []

    for (const collectionName of collections) {
      try {
        await db.createCollection(collectionName)
        results.push(`${collectionName}: 创建成功`)
      } catch (error) {
        if (error.errCode === -1) {
          results.push(`${collectionName}: 已存在`)
        } else {
          results.push(`${collectionName}: 创建失败 - ${error.message}`)
        }
      }
    }

    // 初始化默认设置
    try {
      const settingsRes = await db.collection('settings').where({ key: 'weekly_settings' }).get()
      if (settingsRes.data.length === 0) {
        await db.collection('settings').add({
          data: {
            key: 'weekly_settings',
            weekly_default: 1,
            reset_time: '22:00',
            reset_day: 6, // 周六
            room_names: ['会议室A', '会议室B', '会议室C'],
            created_at: new Date()
          }
        })
        results.push('settings: 默认设置已初始化')
      } else {
        results.push('settings: 默认设置已存在')
      }
    } catch (error) {
      results.push(`settings初始化失败: ${error.message}`)
    }

    // 尝试规范已有用户字段
    try {
      const userRes = await db.collection('users').get()
      const tasks = userRes.data.map((user) => {
        const patch = {}
        if (!user.status) patch.status = 'inactive'
        if (typeof user.used_count !== 'number') patch.used_count = 0
        if (typeof user.extra_count !== 'number') patch.extra_count = 0
        if (typeof user.weekly_default !== 'number') patch.weekly_default = 1
        if (Object.keys(patch).length === 0) return null
        return db.collection('users').doc(user._id).update({ data: patch })
      }).filter(Boolean)
      if (tasks.length > 0) {
        await Promise.all(tasks)
      }
      results.push(`users: 字段修复完成 ${tasks.length} 条`)
    } catch (error) {
      results.push(`users字段修复失败: ${error.message}`)
    }

    return {
      success: true,
      message: '数据库初始化完成',
      results: results
    }
  } catch (err) {
    return {
      success: false,
      message: err.message
    }
  }
}
