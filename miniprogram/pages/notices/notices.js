Page({
  data: {
    notices: [],
    loading: false
  },

  onShow() {
    this.loadNotices()
  },

  formatTime(value) {
    if (!value) return ''
    const dt = new Date(value)
    if (Number.isNaN(dt.getTime())) return String(value).slice(0, 16)
    const m = String(dt.getMonth() + 1).padStart(2, '0')
    const d = String(dt.getDate()).padStart(2, '0')
    const hh = String(dt.getHours()).padStart(2, '0')
    const mm = String(dt.getMinutes()).padStart(2, '0')
    return `${m}-${d} ${hh}:${mm}`
  },

  loadNotices() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'getNotices', scope: 'user' },
      success: (res) => {
        const raw = (res.result && res.result.notices) || []
        const notices = raw.map(item => {
          const content = String(item.content || '').replace(/\s+/g, ' ').trim()
          return {
            ...item,
            contentPreview: content.length > 60 ? content.slice(0, 60) + '...' : content,
            timeText: this.formatTime(item.published_at || item.created_at)
          }
        })
        this.setData({ notices, loading: false })
      },
      fail: (err) => {
        console.error('加载通知失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载通知失败', icon: 'none' })
      }
    })
  },

  openNotice(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/noticeDetail/noticeDetail?id=${id}` })
  }
})
