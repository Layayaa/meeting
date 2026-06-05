// pages/admin/admin.js
Page({
  data: {
    dashboardLoading: false,
    dashboardError: '',
    dashboardStats: {
      weekRange: {
        start: '',
        end: ''
      },
      totalReservations: 0,
      roomUsage: [],
      activeUsers: [],
      peakSlots: [],
      topRoomText: '--',
      topSlotText: '--'
    }
  },

  onShow() {
    this.loadDashboardStats()
  },

  loadDashboardStats() {
    this.setData({
      dashboardLoading: true,
      dashboardError: ''
    })

    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'getDashboardStats'
      },
      success: (res) => {
        const result = res.result || {}
        if (!result.success) {
          this.setData({
            dashboardError: result.message || '统计数据加载失败',
            dashboardLoading: false
          })
          return
        }
        this.setData({
          dashboardStats: result.stats || this.data.dashboardStats,
          dashboardLoading: false
        })
      },
      fail: (err) => {
        console.error('loadDashboardStats failed', err)
        this.setData({
          dashboardError: '统计数据加载失败',
          dashboardLoading: false
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

  goActivityManage() {
    wx.navigateTo({ url: '/pages/activityManage/activityManage' })
  },
  goFeedbackManage() {
    wx.navigateTo({ url: '/pages/feedbackManage/feedbackManage' })
  },

  goNoticeManage() {
    wx.navigateTo({ url: '/pages/noticeManage/noticeManage' })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  }
})
