// 云函数入口文件
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

// 云函数入口函数
exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const phone = normalizePhone(event.phone)
  const password = String(event.password || '')

  try {
    if (!isValidMainlandPhone(phone)) {
      return {
        success: false,
        message: '请输入正确的手机号'
      }
    }
    if (password.length < 6) {
      return {
        success: false,
        message: '密码至少6位'
      }
    }

    const db = cloud.database()
    const adminMatched = await isAdminPhone(db, phone)

    // 检查手机号是否在用户表中（兼容字符串/数字手机号）
    let user = await findUserByPhone(db, phone)

    // 管理员手机号允许自动补建用户记录
    if (!user && adminMatched) {
      const weeklyDefault = await getWeeklyDefault(db)
      const pwd = createPasswordRecord(password)
      const addRes = await db.collection('users').add({
        data: {
          phone,
          name: '管理员',
          department: '',
          openid,
          status: 'active',
          weekly_default: weeklyDefault,
          extra_count: 0,
          used_count: 0,
          ...pwd,
          created_at: new Date(),
          activated_at: new Date()
        }
      })
      const createdRes = await db.collection('users').doc(addRes._id).get()
      user = createdRes.data
    }

    if (!user) {
      return {
        success: false,
        message: '手机号未在系统中，请先注册'
      }
    }

    // 校验/初始化密码
    const patchData = {}
    if (user.password_hash && user.password_salt) {
      const currentHash = hashPassword(password, user.password_salt)
      if (currentHash !== user.password_hash) {
        return {
          success: false,
          message: '手机号或密码错误'
        }
      }
    } else if (typeof user.password === 'string' && user.password.length > 0) {
      if (user.password !== password) {
        return {
          success: false,
          message: '手机号或密码错误'
        }
      }
      Object.assign(patchData, createPasswordRecord(password), { password: '' })
    } else {
      // 历史账号未设置密码时，首次登录自动设为当前输入密码
      Object.assign(patchData, createPasswordRecord(password))
    }

    // 检查是否已被其他openid绑定
    if (user.openid && user.openid !== openid) {
      return {
        success: false,
        message: '该手机号已被其他用户绑定'
      }
    }

    // 绑定并激活用户
    await db.collection('users').doc(user._id).update({
      data: {
        ...patchData,
        openid,
        status: user.status === 'disabled' ? 'disabled' : 'active',
        activated_at: new Date()
      }
    })

    return {
      success: true,
      message: '绑定成功',
      isAdmin: adminMatched,
      userInfo: {
        _id: user._id,
        phone,
        name: user.name,
        department: user.department,
        status: user.status === 'disabled' ? 'disabled' : 'active'
      }
    }
  } catch (err) {
    console.error('绑定手机号失败', err)
    return {
      success: false,
      message: '绑定失败，请重试'
    }
  }
}
