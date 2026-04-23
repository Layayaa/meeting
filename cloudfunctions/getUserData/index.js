// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const DEFAULT_SETTINGS = { weekly_default: 1 }

function calcRemainingCount(user, settings) {
  const weeklyDefault = typeof user.weekly_default === 'number' && user.weekly_default > 0
    ? user.weekly_default
    : (settings.weekly_default || 1)
  const extra = Number(user.extra_count) || 0
  const used = Number(user.used_count) || 0
  return Math.max(0, weeklyDefault + extra - used)
}

// 云函数入口函数
exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const db = cloud.database()

    // 获取用户
    const userRes = await db.collection('users').where({
      openid
    }).get()

    if (userRes.data.length === 0) {
      return {
        isBound: false,
        remainingCount: 0
      }
    }

    const user = userRes.data[0]

    // 获取系统设置
    const settingsRes = await db.collection('settings').where({
      key: 'weekly_settings'
    }).get()
    const settings = (settingsRes.data && settingsRes.data[0]) || DEFAULT_SETTINGS

    const remainingCount = calcRemainingCount(user, settings)

    return {
      isBound: true,
      status: user.status || 'inactive',
      remainingCount,
      userInfo: {
        _id: user._id,
        phone: user.phone,
        name: user.name,
        department: user.department
      }
    }
  } catch (err) {
    console.error('获取用户数据失败', err)
    return {
      isBound: false,
      remainingCount: 0,
      error: err.message
    }
  }
}
