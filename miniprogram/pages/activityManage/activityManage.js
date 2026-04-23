// pages/activityManage/activityManage.js
Page({
  data: {
    activities: [],
    title: '',
    time: '',
    description: '',
    qr_code_url: '',
    editingId: ''
  },

  onShow() {
    this.loadActivities()
  },

  loadActivities() {
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'getActivities' },
      success(res) {
        that.setData({ activities: res.result.activities || [] })
      },
      fail(err) {
        console.error('加载活动失败', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  bindValue(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [key]: e.detail.value })
  },

  chooseQrImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!tempFilePath) {
          wx.showToast({ title: '请选择图片', icon: 'none' })
          return
        }
        wx.showLoading({ title: '上传中...' })
        const cloudPath = `activity_qr/${Date.now()}_${Math.floor(Math.random() * 10000)}.png`
        wx.cloud.uploadFile({
          cloudPath,
          filePath: tempFilePath,
          success: (uploadRes) => {
            wx.hideLoading()
            this.setData({
              qr_code_url: uploadRes.fileID
            })
            wx.showToast({ title: '上传成功', icon: 'success' })
          },
          fail: (err) => {
            wx.hideLoading()
            console.error('上传二维码失败', err)
            wx.showToast({ title: '上传失败', icon: 'none' })
          }
        })
      }
    })
  },

  saveActivity() {
    const { title, time, description, qr_code_url, editingId } = this.data
    if (!title || !time) {
      wx.showToast({ title: '请填写标题和时间', icon: 'none' })
      return
    }
    const action = editingId ? 'updateActivity' : 'addActivity'
    const data = { action, title, time, description, qr_code_url }
    if (editingId) data.activityId = editingId
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data,
      success(res) {
        if (res.result.success) {
          wx.showToast({ title: editingId ? '保存成功' : '添加成功', icon: 'success' })
          that.setData({ title: '', time: '', description: '', qr_code_url: '', editingId: '' })
          that.loadActivities()
        } else {
          wx.showToast({ title: res.result.message || '保存失败', icon: 'none' })
        }
      },
      fail(err) {
        console.error('保存失败', err)
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
  },

  editActivity(e) {
    const item = e.currentTarget.dataset.item
    this.setData({
      editingId: item._id,
      title: item.title,
      time: item.time,
      description: item.description,
      qr_code_url: item.qr_code_url
    })
  },

  deleteActivity(e) {
    const activityId = e.currentTarget.dataset.id
    const that = this
    wx.showModal({
      title: '删除活动',
      content: '确定删除该活动吗？',
      success(res) {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'serviceFunctions',
            data: { action: 'deleteActivity', activityId },
            success(resp) {
              if (resp.result.success) {
                wx.showToast({ title: '删除成功', icon: 'success' })
                that.loadActivities()
              } else {
                wx.showToast({ title: resp.result.message || '删除失败', icon: 'none' })
              }
            },
            fail(err) {
              console.error('删除失败', err)
              wx.showToast({ title: '删除失败', icon: 'none' })
            }
          })
        }
      }
    })
  }
})
