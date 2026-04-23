// pages/userManage/userManage.js
Page({
  data: {
    users: [],
    newUserPhone: '',
    newUserName: '',
    newUserDepartment: ''
  },

  onShow() {
    this.loadUsers()
  },

  loadUsers() {
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'getUsers' },
      success(res) {
        if (res.result.success === false) {
          wx.showToast({ title: res.result.message || '加载失败', icon: 'none' })
          return
        }
        const users = (res.result.users || []).map(u => ({
          ...u,
          avatarChar: (u.name || '用').charAt(0)
        }))
        that.setData({ users })
      },
      fail(err) {
        console.error('加载用户失败', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  bindExtraInput(e) {
    const index = e.currentTarget.dataset.index
    const value = e.detail.value
    this.setData({ [`users[${index}].extraInput`]: value })
  },

  bindNewUserInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({
      [key]: e.detail.value
    })
  },

  addUser() {
    const phone = String(this.data.newUserPhone || '').trim()
    const name = String(this.data.newUserName || '').trim()
    const department = String(this.data.newUserDepartment || '').trim()
    if (!/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请输入正确手机号', icon: 'none' })
      return
    }
    if (!name) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    wx.showLoading({ title: '添加中...' })
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'addUser',
        phone,
        name,
        department
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result && res.result.success) {
          wx.showToast({ title: '添加成功', icon: 'success' })
          this.setData({
            newUserPhone: '',
            newUserName: '',
            newUserDepartment: ''
          })
          this.loadUsers()
        } else {
          wx.showToast({ title: (res.result && res.result.message) || '添加失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('添加用户失败', err)
        wx.showToast({ title: '添加失败', icon: 'none' })
      }
    })
  },

  saveExtraCount(e) {
    const userId = e.currentTarget.dataset.userid
    const user = this.data.users.find(u => u._id === userId)
    const extraCount = Number(user && user.extraInput)
    if (!Number.isFinite(extraCount)) {
      wx.showToast({ title: '请输入次数', icon: 'none' })
      return
    }
    if (extraCount < 0) {
      wx.showToast({ title: '次数不能小于0', icon: 'none' })
      return
    }
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'updateUserExtraCount',
        userId,
        extraCount
      },
      success(res) {
        if (res.result.success) {
          wx.showToast({ title: '派发成功', icon: 'success' })
          that.loadUsers()
        } else {
          wx.showToast({ title: res.result.message || '派发失败', icon: 'none' })
        }
      },
      fail(err) {
        console.error('派发失败', err)
        wx.showToast({ title: '派发失败', icon: 'none' })
      }
    })
  },

  toggleStatus(e) {
    const userId = e.currentTarget.dataset.userid
    const status = e.currentTarget.dataset.status
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'toggleUserStatus', userId, status },
      success(res) {
        if (res.result.success) {
          wx.showToast({ title: '更新成功', icon: 'success' })
          that.loadUsers()
        } else {
          wx.showToast({ title: res.result.message || '更新失败', icon: 'none' })
        }
      },
      fail(err) {
        console.error('更新失败', err)
        wx.showToast({ title: '更新失败', icon: 'none' })
      }
    })
  }
})
