// 云函数入口文件
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

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

// 云函数入口函数
exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const db = cloud.database()
    const userRes = await db.collection('users').where({
      openid
    }).get()

    if (userRes.data.length === 0) {
      return {
        isBound: false,
        isAdmin: false,
        userStatus: 'inactive'
      }
    }

    const user = userRes.data[0]
    const isAdmin = await isAdminPhone(db, user.phone)

    return {
      isBound: true,
      isAdmin,
      userStatus: user.status || 'inactive',
      userInfo: {
        _id: user._id,
        phone: user.phone,
        name: user.name,
        department: user.department,
        status: user.status || 'inactive'
      }
    }
  } catch (err) {
    console.error('检查绑定状态失败', err)
    return {
      isBound: false,
      isAdmin: false,
      userStatus: 'inactive',
      error: err.message
    }
  }
}
