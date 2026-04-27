const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return {
      success: false,
      message: '获取用户标识失败'
    }
  }

  try {
    const db = cloud.database()
    const userRes = await db.collection('users').where({ openid }).get()

    if (!userRes.data || userRes.data.length === 0) {
      return {
        success: true,
        message: '当前未登录'
      }
    }

    await Promise.all(
      userRes.data.map((user) =>
        db.collection('users').doc(user._id).update({
          data: {
            openid: '',
            updated_at: new Date()
          }
        })
      )
    )

    return {
      success: true,
      message: '退出成功',
      count: userRes.data.length
    }
  } catch (err) {
    console.error('logout error', err)
    return {
      success: false,
      message: err.message || '退出失败，请重试'
    }
  }
}
