// pages/settings/settings.js
Page({
  data: {
    weekly_default: 1,
    reset_time: '22:00',
    reset_day: 6,
    contact_wechat: '',
    contact_email: '',
    contact_qr_image: '/images/contact/oacend-wechat.jpg',
    contact_subject_hint: '项目名称+联系人姓名+电话',
    room_details: [],
    room_names: ['会议室A', '会议室B', '会议室C']
  },

  normalizeRoomNamesForForm(roomNames) {
    const defaults = ['会议室A', '会议室B', '会议室C']
    const source = Array.isArray(roomNames) ? roomNames : []
    return defaults.map((fallback, index) => {
      const v = source[index]
      const text = String(v || '').trim()
      return text || fallback
    })
  },

  normalizeRoomDetailsForForm(roomDetails, roomNames) {
    const names = this.normalizeRoomNamesForForm(roomNames)
    const source = Array.isArray(roomDetails) ? roomDetails : []
    return names.map((name, index) => {
      const item = source[index] || {}
      return {
        name,
        image: item.image || `/images/rooms/room-${index + 1}.svg`,
        capacity: Number(item.capacity) || (index === 0 ? 8 : index === 1 ? 12 : 6),
        equipmentText: item.equipmentText || item.equipment || '投影仪、白板、视频会议'
      }
    })
  },

  onShow() {
    this.loadSettings()
  },

  loadSettings() {
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'getSettings' },
      success(res) {
        if (res.result && res.result.settings) {
          const settings = res.result.settings
          that.setData({
            weekly_default: settings.weekly_default || 1,
            reset_time: settings.reset_time || '22:00',
            reset_day: typeof settings.reset_day === 'number' ? settings.reset_day : 6,
            contact_wechat: settings.contact_wechat || '',
            contact_email: settings.contact_email || '3963632979@qq.com',
            contact_qr_image: settings.contact_qr_image || '/images/contact/oacend-wechat.jpg',
            contact_subject_hint: settings.contact_subject_hint || '项目名称+联系人姓名+电话',
            room_names: that.normalizeRoomNamesForForm(settings.room_names),
            room_details: that.normalizeRoomDetailsForForm(settings.room_details, settings.room_names)
          })
        }
      },
      fail(err) {
        console.error('加载设置失败', err)
        wx.showToast({ title: '加载设置失败', icon: 'none' })
      }
    })
  },

  bindDefaultChange(e) {
    this.setData({ weekly_default: Number(e.detail.value) })
  },

  bindRoomNameChange(e) {
    const index = Number(e.currentTarget.dataset.index)
    const value = String(e.detail.value || '')
    this.setData({
      [`room_names[${index}]`]: value,
      [`room_details[${index}].name`]: value
    })
  },

  bindRoomDetailChange(e) {
    const index = Number(e.currentTarget.dataset.index)
    const key = e.currentTarget.dataset.key
    if (!key) return
    const value = key === 'capacity' ? Number(e.detail.value) : String(e.detail.value || '')
    this.setData({
      [`room_details[${index}].${key}`]: value
    })
  },

  chooseRoomImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isFinite(index) || index < 0) return
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
        const extMatch = tempFilePath.match(/\.(jpg|jpeg|png|webp)$/i)
        const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg'
        const cloudPath = `room_images/${Date.now()}_${index}_${Math.floor(Math.random() * 10000)}.${ext}`
        wx.cloud.uploadFile({
          cloudPath,
          filePath: tempFilePath,
          success: (uploadRes) => {
            wx.hideLoading()
            this.setData({
              [`room_details[${index}].image`]: uploadRes.fileID
            })
            wx.showToast({ title: '上传成功，请保存', icon: 'none' })
          },
          fail: (err) => {
            wx.hideLoading()
            console.error('上传会议室图片失败', err)
            wx.showToast({ title: '上传失败', icon: 'none' })
          }
        })
      },
      fail: () => {
        wx.showToast({ title: '未选择图片', icon: 'none' })
      }
    })
  },

  bindContactChange(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({
      [key]: String(e.detail.value || '')
    })
  },

  saveSettings() {
    const { weekly_default, reset_time, reset_day, room_names, room_details, contact_wechat, contact_email, contact_qr_image, contact_subject_hint } = this.data
    if (!weekly_default || weekly_default <= 0) {
      wx.showToast({ title: '请输入正确的默认次数', icon: 'none' })
      return
    }
    if (!reset_time) {
      wx.showToast({ title: '请输入刷新时间', icon: 'none' })
      return
    }
    const normalizedRooms = this.normalizeRoomNamesForForm(room_names)
      .map((name) => String(name || '').trim())
    if (normalizedRooms.some((name) => !name)) {
      wx.showToast({ title: '会议室名称不能为空', icon: 'none' })
      return
    }
    if (normalizedRooms.length !== new Set(normalizedRooms).size) {
      wx.showToast({ title: '会议室名称不能重复', icon: 'none' })
      return
    }
    const normalizedDetails = this.normalizeRoomDetailsForForm(room_details, normalizedRooms)
    if (normalizedDetails.some((item) => !item.capacity || item.capacity <= 0)) {
      wx.showToast({ title: '可容纳人数需大于0', icon: 'none' })
      return
    }
    const that = this
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: {
        action: 'updateSettings',
        weekly_default,
        reset_time,
        reset_day,
        room_names: normalizedRooms,
        room_details: normalizedDetails,
        contact_wechat: String(contact_wechat || '').trim(),
        contact_email: String(contact_email || '').trim(),
        contact_qr_image: String(contact_qr_image || '').trim(),
        contact_subject_hint: String(contact_subject_hint || '').trim()
      },
      success(res) {
        if (res.result && res.result.success) {
          wx.showToast({ title: '保存成功', icon: 'success' })
          that.loadSettings()
        } else {
          wx.showToast({ title: res.result.message || '保存失败', icon: 'none' })
        }
      },
      fail(err) {
        console.error('保存设置失败', err)
        wx.showToast({ title: '保存失败', icon: 'none' })
      }
    })
  },

  refreshWeeklyCounts() {
    const that = this
    wx.showModal({
      title: '立即重置',
      content: '确认立即刷新所有用户本周使用次数吗？',
      success(res) {
        if (res.confirm) {
          wx.showLoading({ title: '重置中...' })
          wx.cloud.callFunction({
            name: 'serviceFunctions',
            data: { action: 'refreshWeeklyCounts' },
            success(resp) {
              wx.hideLoading()
              if (resp.result && resp.result.success) {
                wx.showToast({ title: '重置成功', icon: 'success' })
                that.loadSettings()
              } else {
                wx.showToast({ title: resp.result.message || '重置失败', icon: 'none' })
              }
            },
            fail(err) {
              wx.hideLoading()
              console.error('重置失败', err)
              wx.showToast({ title: '重置失败', icon: 'none' })
            }
          })
        }
      }
    })
  }
})
