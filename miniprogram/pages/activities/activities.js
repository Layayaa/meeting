// pages/activities/activities.js
Page({
  data: {
    activities: []
  },

  onShow() {
    this.loadActivities()
  },

  loadActivities() {
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'getActivities'
      },
      success(res) {
        that.setData({ activities: res.result.activities || [] })
      },
      fail(err) {
        console.error('加载活动失败', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  openQr(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({
      urls: [url]
    })
  },

  openLink(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success() {
        wx.showToast({
          title: '链接已复制',
          icon: 'success'
        })
      }
    })
  }
})
