Page({
  data: {
    list: [],
    loading: false
  },

  onShow() {
    this.loadList()
  },

  loadList() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'getMyFeedbacks' },
      success: (res) => {
        const result = res.result || {}
        this.setData({
          list: result.feedbacks || [],
          loading: false
        })
      },
      fail: (err) => {
        console.error('加载反馈失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  goSubmit() {
    wx.navigateTo({ url: '/pages/feedbackSubmit/feedbackSubmit' })
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/feedbackDetail/feedbackDetail?id=${id}`
    })
  }
})
