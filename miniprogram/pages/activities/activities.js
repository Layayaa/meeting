// pages/activities/activities.js
Page({
  data: {
    activities: [],
    loading: false,
    errorMsg: ''
  },

  onShow() {
    this.loadActivities()
  },

  loadActivities() {
    this.setData({
      loading: true,
      errorMsg: ''
    })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'getActivities'
      },
      success: (res) => {
        const result = (res && res.result) || {}
        if (result.success === false) {
          this.setData({
            activities: [],
            loading: false,
            errorMsg: result.message || '活动加载失败'
          })
          return
        }
        this.setData({
          activities: Array.isArray(result.activities) ? result.activities : [],
          loading: false,
          errorMsg: ''
        })
      },
      fail: (err) => {
        console.error('加载活动失败', err)
        this.setData({
          activities: [],
          loading: false,
          errorMsg: '网络异常，请稍后重试'
        })
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
