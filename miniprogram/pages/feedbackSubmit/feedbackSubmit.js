Page({
  data: {
    content: '',
    images: [],
    submitting: false
  },

  bindContent(e) {
    this.setData({ content: e.detail.value })
  },

  chooseImages() {
    const remain = 3 - this.data.images.length
    if (remain <= 0) {
      wx.showToast({ title: '最多3张图片', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const files = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean)
        for (const filePath of files) {
          try {
            wx.showLoading({ title: '上传图片...' })
            const cloudPath = `feedback/${Date.now()}_${Math.floor(Math.random() * 10000)}.png`
            const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
            const next = this.data.images.concat(uploadRes.fileID).slice(0, 3)
            this.setData({ images: next })
          } catch (err) {
            console.error('上传图片失败', err)
            wx.showToast({ title: '上传失败', icon: 'none' })
            break
          } finally {
            wx.hideLoading()
          }
        }
      }
    })
  },

  removeImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const arr = this.data.images.slice()
    arr.splice(index, 1)
    this.setData({ images: arr })
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({ urls: this.data.images, current: url })
  },

  submit() {
    if (this.data.submitting) return
    const content = String(this.data.content || '').trim()
    if (!content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }
    if (content.length > 500) {
      wx.showToast({ title: '最多500字', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...' })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'submitFeedback',
        content,
        images: this.data.images
      },
      success: (res) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        const result = res.result || {}
        if (result.success) {
          wx.showToast({ title: '感谢您的反馈', icon: 'success' })
          setTimeout(() => {
            wx.redirectTo({ url: '/pages/myFeedbacks/myFeedbacks' })
          }, 300)
        } else {
          wx.showToast({ title: result.message || '提交失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        this.setData({ submitting: false })
        console.error('提交反馈失败', err)
        wx.showToast({ title: '提交失败', icon: 'none' })
      }
    })
  }
})
