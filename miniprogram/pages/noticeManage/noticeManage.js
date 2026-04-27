Page({
  data: {
    status: 'all',
    list: [],
    displayList: [],
    loading: false
  },

  onShow() {
    this.loadList()
  },

  selectStatus(e) {
    const status = e.currentTarget.dataset.status || 'all'
    this.setData({ status })
    this.applyFilter()
  },

  loadList() {
    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'getNotices',
        scope: 'admin'
      },
      success: (res) => {
        const result = res.result || {}
        this.setData({ list: result.notices || [], loading: false })
        this.applyFilter()
      },
      fail: (err) => {
        console.error('加载通知管理失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  createNotice() {
    wx.navigateTo({ url: '/pages/noticeEdit/noticeEdit' })
  },

  editNotice(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/noticeEdit/noticeEdit?id=${id}`
    })
  },

  deleteNotice(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除通知',
      content: '确定删除该通知吗？',
      success: (res) => {
        if (!res.confirm) return
        wx.cloud.callFunction({
          name: 'serviceFunctions',
          data: {
            action: 'deleteNotice',
            noticeId: id
          },
          success: (resp) => {
            const result = resp.result || {}
            if (result.success) {
              wx.showToast({ title: '删除成功', icon: 'success' })
              this.loadList()
            } else {
              wx.showToast({ title: result.message || '删除失败', icon: 'none' })
            }
          },
          fail: (err) => {
            console.error('删除通知失败', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        })
      }
    })
  },

  applyFilter() {
    const status = this.data.status
    const all = this.data.list || []
    let displayList = all
    if (status !== 'all') {
      displayList = all.filter((item) => (item.status || 'draft') === status)
    }
    this.setData({ displayList })
  }
})
