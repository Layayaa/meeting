Page({
  data: {
    id: '',
    title: '',
    content: '',
    is_pinned: false,
    status: 'draft',
    loading: false,
    saving: false
  },

  onLoad(options) {
    const id = options.id || ''
    this.setData({ id })
    if (id) {
      wx.setNavigationBarTitle({ title: '编辑通知' })
      this.loadDetail()
    } else {
      wx.setNavigationBarTitle({ title: '新建通知' })
    }
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
        const notice = result.notice || {}
        this.setData({
          title: notice.title || '',
          content: notice.content || '',
          is_pinned: !!notice.is_pinned,
          status: notice.status || 'draft',
          loading: false
        })
      },
      fail: (err) => {
        console.error('加载通知详情失败', err)
        this.setData({ loading: false })
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  bindInput(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ [key]: e.detail.value })
  },

  bindPinned(e) {
    this.setData({ is_pinned: !!e.detail.value })
  },

  selectStatus(e) {
    const status = e.currentTarget.dataset.status || 'draft'
    this.setData({ status })
  },

  saveDraft() {
    this.saveNotice('draft')
  },

  publish() {
    this.saveNotice('published')
  },

  saveNotice(status) {
    if (this.data.saving) return
    const title = String(this.data.title || '').trim()
    const content = String(this.data.content || '').trim()
    if (!title) {
      wx.showToast({ title: '请输入通知标题', icon: 'none' })
      return
    }
    if (!content) {
      wx.showToast({ title: '请输入通知内容', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...' })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'saveNotice',
        noticeId: this.data.id,
        title,
        content,
        is_pinned: this.data.is_pinned,
        status
      },
      success: (res) => {
        wx.hideLoading()
        this.setData({ saving: false })
        const result = res.result || {}
        if (result.success) {
          wx.showToast({ title: status === 'published' ? '发布成功' : '保存成功', icon: 'success' })
          setTimeout(() => {
            wx.navigateBack()
          }, 300)
        } else {
          wx.showToast({ title: result.message || '保存失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        this.setData({ saving: false })
        console.error('保存通知失败', err)
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
  }
})
