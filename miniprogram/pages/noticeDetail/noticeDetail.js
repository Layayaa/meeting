Page({
  data: {
    id: '',
    notice: null,
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
        action: 'getNoticeDetail',
        noticeId: this.data.id
      },
      success: (res) => {
        const result = res.result || {}
        if (!result.success) {
          wx.showToast({ title: result.message || '加载失败', icon: 'none' })
          this.setData({ loading: false })
          return
        }
        const notice = result.notice || null
        this.setData({ notice, loading: false })
        if (notice && notice.title) {
          wx.setNavigationBarTitle({ title: notice.title })
        }
      },
      fail: (err) => {
        console.error('加载通知详情失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  }
})
