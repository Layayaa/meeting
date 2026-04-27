Page({
  data: {
    id: '',
    detail: null,
    loading: false
  },

  onLoad(options) {
    this.setData({ id: options.id || '' })
    this.loadDetail()
  },

  loadDetail() {
    if (!this.data.id) return
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'getFeedbackDetail',
        feedbackId: this.data.id
      },
      success: (res) => {
        const result = res.result || {}
        if (!result.success) {
          wx.showToast({ title: result.message || '加载失败', icon: 'none' })
          this.setData({ loading: false })
          return
        }
        this.setData({ detail: result.feedback || null, loading: false })
      },
      fail: (err) => {
        console.error('加载反馈详情失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url
    const detail = this.data.detail || {}
    const images = detail.images || []
    if (!url || !images.length) return
    wx.previewImage({ urls: images, current: url })
  }
})
