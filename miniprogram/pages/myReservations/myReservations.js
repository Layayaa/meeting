// pages/myReservations/myReservations.js
Page({
  data: {
    isBound: false,
    isAdmin: false,
    userStatus: 'inactive',
    userInfo: null,
    avatarChar: '用',
    remainingCount: 0,
    dashboardLoading: false,
    dashboardStats: {
      weekRange: { start: '', end: '' },
      totalReservations: 0,
      roomUsage: [],
      activeUsers: [],
      peakSlots: [],
      topRoomText: '--',
      topSlotText: '--'
    },
    reservations: [],
    loading: false,
    showPasswordForm: false,
    passwordForm: {
      oldPassword: '',
      newPassword: '',
      confirmPassword: ''
    },
    passwordSubmitting: false
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
          isAdmin: !!result.isAdmin,
          userStatus: result.userStatus || 'inactive',
          userInfo,
          avatarChar,
          remainingCount: Number(result.remainingCount) || 0,
          loading: false
        })
        if (isBound) {
          if (this.data.isAdmin) {
            this.loadDashboardStats()
          } else {
            this.loadReservations()
          }
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

  loadDashboardStats() {
    this.setData({ dashboardLoading: true })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'getDashboardStats'
      },
      success: (res) => {
        const result = res.result || {}
        if (result.success && result.stats) {
          this.setData({
            dashboardStats: result.stats,
            dashboardLoading: false
          })
          return
        }
        this.setData({ dashboardLoading: false })
      },
      fail: (err) => {
        console.error('loadDashboardStats failed', err)
        this.setData({ dashboardLoading: false })
      }
    })
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login'
    })
  },

  goFeedbackSubmit() {
    wx.navigateTo({
      url: '/pages/feedbackSubmit/feedbackSubmit'
    })
  },

  goMyFeedbacks() {
    wx.navigateTo({
      url: '/pages/myFeedbacks/myFeedbacks'
    })
  },

  togglePasswordForm() {
    this.setData({
      showPasswordForm: !this.data.showPasswordForm,
      passwordForm: {
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
      }
    })
  },

  bindPasswordInput(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({
      [`passwordForm.${key}`]: e.detail.value
    })
  },

  submitChangePassword() {
    if (this.data.passwordSubmitting) return
    const oldPassword = String(this.data.passwordForm.oldPassword || '')
    const newPassword = String(this.data.passwordForm.newPassword || '')
    const confirmPassword = String(this.data.passwordForm.confirmPassword || '')

    if (oldPassword.length < 6) {
      wx.showToast({ title: '请输入当前密码', icon: 'none' })
      return
    }
    if (newPassword.length < 6) {
      wx.showToast({ title: '新密码至少6位', icon: 'none' })
      return
    }
    if (newPassword !== confirmPassword) {
      wx.showToast({ title: '两次密码不一致', icon: 'none' })
      return
    }

    this.setData({ passwordSubmitting: true })
    wx.showLoading({ title: '修改中...' })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'changePassword',
        oldPassword,
        newPassword
      },
      success: (res) => {
        wx.hideLoading()
        this.setData({ passwordSubmitting: false })
        const result = res.result || {}
        if (result.success) {
          wx.showToast({ title: '修改成功', icon: 'success' })
          this.setData({
            showPasswordForm: false,
            passwordForm: {
              oldPassword: '',
              newPassword: '',
              confirmPassword: ''
            }
          })
          return
        }
        wx.showToast({ title: result.message || '修改失败', icon: 'none' })
      },
      fail: (err) => {
        wx.hideLoading()
        this.setData({ passwordSubmitting: false })
        console.error('changePassword failed', err)
        wx.showToast({ title: '修改失败', icon: 'none' })
      }
    })
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号吗？',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '退出中...' })
        wx.cloud.callFunction({
          name: 'logout',
          success: (resp) => {
            wx.hideLoading()
            if (resp.result && resp.result.success) {
              const app = getApp()
              if (app && app.globalData) {
                app.globalData.userInfo = null
                app.globalData.isAdmin = false
              }
              this.setData({
                isBound: false,
                userStatus: 'inactive',
                userInfo: null,
                remainingCount: 0,
                reservations: []
              })
              wx.showToast({
                title: '已退出',
                icon: 'success'
              })
            } else {
              wx.showToast({
                title: (resp.result && resp.result.message) || '退出失败',
                icon: 'none'
              })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            console.error('退出失败', err)
            wx.showToast({
              title: '退出失败',
              icon: 'none'
            })
          }
        })
      }
    })
  },

  goUserManage() {
    wx.navigateTo({ url: '/pages/userManage/userManage' })
  },

  goReservationManage() {
    wx.navigateTo({ url: '/pages/reservationManage/reservationManage' })
  },

  goFeedbackManage() {
    wx.navigateTo({ url: '/pages/feedbackManage/feedbackManage' })
  },

  goNoticeManage() {
    wx.navigateTo({ url: '/pages/noticeManage/noticeManage' })
  },

  goActivityManage() {
    wx.navigateTo({ url: '/pages/activityManage/activityManage' })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
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
                that.checkUserStatus()
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
