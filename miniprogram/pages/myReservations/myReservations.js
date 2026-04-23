// pages/myReservations/myReservations.js
Page({
  data: {
    isBound: false,
    userStatus: 'inactive',
    userInfo: null,
    remainingCount: 0,
    reservations: [],
    loading: false
  },

  onShow() {
    this.checkUserStatus()
  },

  parseDateTime(date, timeSlot) {
    const [startTime] = timeSlot.split('-')
    const [hour, minute] = startTime.split(':').map(Number)
    const dt = new Date(date)
    dt.setHours(hour, minute, 0, 0)
    return dt
  },

  canCancel(reservation) {
    if (reservation.status !== 'pending') {
      return false
    }
    const startTime = this.parseDateTime(reservation.date, reservation.time_slot)
    const now = new Date()
    return (startTime - now) / 1000 / 60 / 60 > 2
  },

  checkUserStatus() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'getUserStatus',
      success: (res) => {
        const result = res.result || {}
        const isBound = !!result.isBound
        const userInfo = result.userInfo || null
        const avatarChar = userInfo ? (userInfo.name || '用').charAt(0) : '用'
        this.setData({
          isBound,
          userStatus: result.userStatus || 'inactive',
          userInfo,
          avatarChar,
          remainingCount: Number(result.remainingCount) || 0,
          loading: false
        })
        if (isBound) {
          this.loadReservations()
        } else {
          this.setData({
            reservations: []
          })
        }
      },
      fail: (err) => {
        console.error('检查用户状态失败', err)
        this.setData({
          loading: false,
          isBound: false,
          userStatus: 'inactive',
          userInfo: null,
          remainingCount: 0,
          reservations: []
        })
      }
    })
  },

  loadReservations() {
    const that = this
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'getMyReservations'
      },
      success(res) {
        const reservations = (res.result.reservations || []).map(item => ({
          ...item,
          canCancel: typeof item.canCancel === 'boolean' ? item.canCancel : that.canCancel(item),
          statusText: item.statusText || that.formatStatus(item.status),
          cancelTip: item.cancelTip || ''
        }))
        that.setData({
          reservations,
          loading: false
        })
      },
      fail(err) {
        that.setData({ loading: false })
        console.error('加载我的预约失败', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login'
    })
  },

  formatStatus(status) {
    if (status === 'pending') return '待使用'
    if (status === 'completed') return '已完成'
    if (status === 'cancelled') return '已取消'
    return status || '未知'
  },

  cancelReservation(e) {
    const reservationId = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '取消预约',
      content: '确认取消该预约吗？',
      success(res) {
        if (res.confirm) {
          wx.showLoading({ title: '取消中...' })
          wx.cloud.callFunction({
            name: 'serviceFunctions',
            data: {
              action: 'cancelReservation',
              reservationId
            },
            success(resp) {
              wx.hideLoading()
              if (resp.result.success) {
                wx.showToast({ title: '取消成功', icon: 'success' })
                that.loadReservations()
              } else {
                wx.showToast({ title: resp.result.message || '取消失败', icon: 'none' })
              }
            },
            fail(err) {
              wx.hideLoading()
              console.error('取消失败', err)
              wx.showToast({ title: '取消失败', icon: 'none' })
            }
          })
        }
      }
    })
  }
})
