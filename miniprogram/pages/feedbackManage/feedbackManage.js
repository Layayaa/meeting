Page({
  data: {
    status: 'all',
    list: [],
    loading: false
  },

  onShow() {
    this.loadList()
  },

  selectStatus(e) {
    const status = e.currentTarget.dataset.status || 'all'
    this.setData({ status })
    this.loadList()
  },

  loadList() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'getFeedbacksAdmin',
        status: this.data.status
      },
      success: (res) => {
        const result = res.result || {}
        if (!result.success) {
          wx.showToast({ title: result.message || '加载失败', icon: 'none' })
          this.setData({ loading: false })
          return
        }
        this.setData({ list: result.feedbacks || [], loading: false })
      },
      fail: (err) => {
        console.error('加载反馈管理失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/feedbackReply/feedbackReply?id=${id}`
    })
  }
})
