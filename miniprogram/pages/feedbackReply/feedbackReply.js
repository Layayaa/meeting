Page({
  data: {
    id: '',
    detail: null,
    replyInput: '',
    submitting: false,
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
        const detail = result.feedback || null
        this.setData({
          detail,
          replyInput: detail && detail.admin_reply ? detail.admin_reply : '',
          loading: false
        })
      },
      fail: (err) => {
        console.error('加载反馈详情失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  bindReply(e) {
    this.setData({ replyInput: e.detail.value })
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url
    const detail = this.data.detail || {}
    const images = detail.images || []
    if (!url || !images.length) return
    wx.previewImage({ urls: images, current: url })
  },

  submitReply() {
    if (this.data.submitting) return
    const content = String(this.data.replyInput || '').trim()
    if (!content) {
      wx.showToast({ title: '请输入回复内容', icon: 'none' })
      return
    }
    if (content.length > 500) {
      wx.showToast({ title: '回复最多500字', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'replyFeedback',
        feedbackId: this.data.id,
        admin_reply: content
      },
      success: (res) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        const result = res.result || {}
        if (result.success) {
          wx.showToast({ title: '回复成功', icon: 'success' })
          this.loadDetail()
        } else {
          wx.showToast({ title: result.message || '提交失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        console.error('回复失败', err)
        wx.showToast({ title: '回复失败', icon: 'none' })
      }
    })
  }
})
