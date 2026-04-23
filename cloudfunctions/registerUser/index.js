const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length === 11) return digits
  if (digits.length === 13 && digits.startsWith('86')) return digits.slice(2)
  return digits
}

function isValidMainlandPhone(phone) {
  return /^1\d{10}$/.test(phone)
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

async function isAdminPhone(db, phone) {
  const adminRes = await db.collection('admins').get()
  return adminRes.data.some((item) => normalizePhone(item.phone) === phone)
}

async function findUserByPhone(db, phone) {
  const userRes = await db.collection('users').where({ phone }).get()
  if (userRes.data.length > 0) {
    return userRes.data[0]
  }
  const numberPhone = Number(phone)
  if (Number.isFinite(numberPhone)) {
    const numberRes = await db.collection('users').where({ phone: numberPhone }).get()
    if (numberRes.data.length > 0) {
      return numberRes.data[0]
    }
  }
  return null
}

async function getWeeklyDefault(db) {
  const settingsRes = await db.collection('settings').where({ key: 'weekly_settings' }).get()
  const settings = settingsRes.data[0] || { weekly_default: 1 }
  return typeof settings.weekly_default === 'number' && settings.weekly_default > 0
    ? settings.weekly_default
    : 1
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const phone = normalizePhone(event.phone)
    const nickname = String(event.nickname || event.name || '').trim()
    const password = String(event.password || '')

    if (!isValidMainlandPhone(phone)) {
      return { success: false, message: '请输入正确的手机号' }
    }
    if (!nickname) {
      return { success: false, message: '请输入昵称' }
    }
    if (nickname.length > 20) {
      return { success: false, message: '昵称最多20个字符' }
    }
    if (password.length < 6) {
      return { success: false, message: '密码至少6位' }
    }

    const db = cloud.database()
    const existed = await findUserByPhone(db, phone)
    if (existed) {
      if (existed.openid && existed.openid !== openid) {
        return { success: false, message: '手机号已被其他账号绑定' }
      }
      await db.collection('users').doc(existed._id).update({
        data: {
          name: nickname,
          department: existed.department || '',
          ...createPasswordRecord(password),
          password: '',
          openid,
          status: existed.status === 'disabled' ? 'disabled' : 'active',
          activated_at: new Date(),
          updated_at: new Date()
        }
      })
      return {
        success: true,
        message: '注册并绑定成功',
        userInfo: {
          _id: existed._id,
          phone,
          name: nickname,
          department: existed.department || '',
          status: existed.status === 'disabled' ? 'disabled' : 'active'
        }
      }
    }

    const weeklyDefault = await getWeeklyDefault(db)
    const adminMatched = await isAdminPhone(db, phone)
    const addRes = await db.collection('users').add({
      data: {
        phone,
        name: nickname,
        department: '',
        ...createPasswordRecord(password),
        password: '',
        openid,
        status: 'active',
        weekly_default: weeklyDefault,
        extra_count: 0,
        used_count: 0,
        created_at: new Date(),
        activated_at: new Date(),
        source: adminMatched ? 'admin_auto_register' : 'self_register'
      }
    })

    return {
      success: true,
      message: '注册并绑定成功',
      isAdmin: adminMatched,
      userInfo: {
        _id: addRes._id,
        phone,
        name: nickname,
        department: '',
        status: 'active'
      }
    }
  } catch (err) {
    console.error('registerUser error', err)
    return {
      success: false,
      message: err.message || '注册失败，请重试'
    }
  }
}
