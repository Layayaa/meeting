// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const DEFAULT_SETTINGS = { weekly_default: 1 }

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 11) return digits
  if (digits.length === 13 && digits.startsWith('86')) return digits.slice(2)
  return digits
}

async function isAdminPhone(db, phone) {
  const normalized = normalizePhone(phone)
  const adminRes = await db.collection('admins').get()
  return adminRes.data.some((item) => normalizePhone(item.phone) === normalized)
}

function calcRemainingCount(user, settings) {
  const weeklyDefault = typeof settings.weekly_default === 'number' && settings.weekly_default > 0
    ? settings.weekly_default
    : 1
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

    // 查询用户
    const userRes = await db.collection('users').where({
      openid
    }).get()

    if (userRes.data.length === 0) {
      return {
        isBound: false,
        isAdmin: false,
        userStatus: 'inactive',
        remainingCount: 0
      }
    }

    const user = userRes.data[0]

    // 检查是否为管理员
    const isAdmin = await isAdminPhone(db, user.phone)

    // 读取设置并计算剩余次数
    const settingsRes = await db.collection('settings').where({
      key: 'weekly_settings'
    }).get()
    const settings = (settingsRes.data && settingsRes.data[0]) || DEFAULT_SETTINGS
    const remainingCount = calcRemainingCount(user, settings)

    return {
      isBound: true,
      isAdmin,
      userStatus: user.status || 'inactive',
      remainingCount,
      userInfo: {
        _id: user._id,
        phone: user.phone,
        name: user.name,
        department: user.department,
        status: user.status || 'inactive',
        weekly_default: Number(user.weekly_default) || 0,
        extra_count: Number(user.extra_count) || 0,
        used_count: Number(user.used_count) || 0
      }
    }
  } catch (err) {
    console.error('获取用户状态失败', err)
    return {
      isBound: false,
      isAdmin: false,
      userStatus: 'inactive',
      remainingCount: 0,
      error: err.message
    }
  }
}
