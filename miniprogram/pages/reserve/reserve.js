// pages/reserve/reserve.js
Page({
  data: {
    selectedDate: '',
    selectedRoom: '',
    selectedTimeSlot: '',
    purpose: '',
    purposeLength: 0,
    isBound: false,
    userStatus: 'inactive',
    remainingCount: 0,
    dates: [],
    rooms: ['会议室A', '会议室B', '会议室C'],
    roomDetails: [],
    selectedRoomDetail: null,
    timeSlots: [],
    timeSlotViews: [],
    weeklyLoading: false,
    weekDates: [],
    weekRows: [],
    reserveBlockReason: '',
    reservations: [],
    showVoucher: false,
    reservationVoucher: {
      reservationId: '',
      date: '',
      room: '',
      timeSlot: '',
      purpose: '',
      statusText: '',
      createdAtText: ''
    },
    loading: false
  },

  onLoad: function() {
    this.initTimeSlots();
    this.loadRoomSettings();
    this.loadWeeklyAvailability();
    this.checkUserStatus();
    this.generateDates();
    this.setDefaultDate();
  },

  loadRoomSettings: function() {
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'getSettings' },
      success: (res) => {
        const settings = res.result && res.result.settings
        const rooms = (settings && Array.isArray(settings.room_names) && settings.room_names.length)
          ? settings.room_names
          : ['会议室A', '会议室B', '会议室C']
        const roomDetails = (settings && Array.isArray(settings.room_details) && settings.room_details.length)
          ? settings.room_details
          : rooms.map((name, index) => ({
              name,
              image: `/images/rooms/room-${index + 1}.svg`,
              capacity: index === 0 ? 8 : index === 1 ? 12 : 6,
              equipmentText: '投影仪、白板、视频会议'
            }))
        this.setData({ rooms, roomDetails })
      },
      fail: (err) => {
        console.error('加载会议室设置失败', err)
      }
    })
  },

  initTimeSlots: function() {
    const slots = [];
    for (let hour = 8; hour < 22; hour++) {
      const start = `${String(hour).padStart(2, '0')}:00`;
      const end = `${String(hour + 1).padStart(2, '0')}:00`;
      slots.push(`${start}-${end}`);
    }
    this.setData({
      timeSlots: slots
    });
  },

  onShow: function() {
    if (this.data.selectedDate) {
      this.loadReservations(this.data.selectedDate);
      this.loadWeeklyAvailability();
      this.checkUserStatus();
    }
  },

  isWeeklyCellExpired: function(date, timeSlot) {
    const [startTime] = String(timeSlot || '').split('-');
    const [hour, minute] = String(startTime || '').split(':').map(Number);
    const slotTime = new Date(`${date}T00:00:00`);
    if (Number.isNaN(slotTime.getTime()) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      return false;
    }
    slotTime.setHours(hour, minute, 0, 0);
    return slotTime <= new Date();
  },

  loadWeeklyAvailability: function() {
    this.setData({ weeklyLoading: true });
    wx.cloud.callFunction({
      name: 'serviceFunctions',
      data: { action: 'getWeeklyAvailability' },
      success: (res) => {
        const result = res.result || {};
        const availability = result.availability || {};
        const weekRows = (availability.rows || []).map((row) => ({
          ...row,
          cells: (row.cells || []).map((cell) => {
            if (!this.isWeeklyCellExpired(cell.date, cell.timeSlot)) {
              return cell;
            }
            return {
              ...cell,
              status: 'expired',
              className: 'availability-cell expired',
              statusText: '过期',
              availableCount: 0,
              availableRooms: []
            };
          })
        }));
        this.setData({
          weekDates: availability.dates || [],
          weekRows,
          weeklyLoading: false
        });
      },
      fail: (err) => {
        console.error('loadWeeklyAvailability failed', err);
        this.setData({ weeklyLoading: false });
      }
    });
  },

  checkUserStatus: function() {
    wx.cloud.callFunction({
      name: 'getUserStatus',
      success: (res) => {
        const result = res.result || {};
        this.setData({
          isBound: !!result.isBound,
          userStatus: result.userStatus || 'inactive',
          remainingCount: Number(result.remainingCount) || 0,
          reserveBlockReason: this.computeReserveBlockReason(
            !!result.isBound,
            result.userStatus || 'inactive',
            Number(result.remainingCount) || 0
          )
        });
      },
      fail: (err) => {
        console.error('getUserStatus 失败', err);
        this.setData({
          reserveBlockReason: '用户状态加载失败，请重试'
        });
        wx.showToast({
          title: '用户状态加载失败',
          icon: 'none'
        });
      }
    });
  },

  computeReserveBlockReason: function(isBound, userStatus, remainingCount) {
    if (!isBound) return '请先到【我的】页面登录/注册';
    if (userStatus !== 'active') return '当前账号不可预约，请联系处理人员';
    if (remainingCount <= 0) return '本周预约次数已用完';
    return ''
  },

  generateDates: function() {
    const dates = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const weekDay = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];

      dates.push({
        date: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
        display: `${month}/${day} 周${weekDay}`,
        dayLabel: i === 0 ? '今天' : i === 1 ? '明天' : `周${weekDay}`,
        monthDay: `${month}/${day}`,
        isToday: i === 0
      });
    }

    this.setData({
      dates: dates
    });
  },

  setDefaultDate: function() {
    const today = this.data.dates[0];
    if (!today) return;
    this.setData({
      selectedDate: today.date
    });
    this.computeTimeSlotViews();
    this.loadReservations(today.date);
  },

  selectDate: function(e) {
    const date = e.currentTarget.dataset.date;
    this.setData({
      selectedDate: date,
      selectedRoom: '',
      selectedTimeSlot: '',
      selectedRoomDetail: null
    });
    this.computeTimeSlotViews();
    this.loadReservations(date);
  },

  selectRoom: function(e) {
    const room = e.currentTarget.dataset.room;
    const selectedRoomDetail = this.data.roomDetails.find((item) => item.name === room) || null;
    this.setData({
      selectedRoom: room,
      selectedTimeSlot: '',
      selectedRoomDetail
    });
    this.computeTimeSlotViews();
  },

  selectTimeSlot: function(e) {
    const timeSlot = e.currentTarget.dataset.timeslot;
    if (!this.data.selectedDate || !this.data.selectedRoom) {
      return;
    }
    if (this.isTimeSlotExpired(this.data.selectedDate, timeSlot)) {
      wx.showToast({
        title: '该时段已过期',
        icon: 'none'
      });
      return;
    }
    if (this.isTimeSlotFull(timeSlot)) {
      wx.showToast({
        title: '该时段已满',
        icon: 'none'
      });
      return;
    }
    if (this.isTimeSlotReserved(this.data.selectedRoom, timeSlot)) {
      wx.showToast({
        title: '该时段已被预约',
        icon: 'none'
      });
      return;
    }
    this.setData({
      selectedTimeSlot: timeSlot
    });
    this.computeTimeSlotViews();
  },

  selectAvailabilityCell: function(e) {
    const { date, timeslot, status } = e.currentTarget.dataset;
    const targetRow = this.data.weekRows.find((row) => row.timeSlot === timeslot);
    const targetCell = targetRow && targetRow.cells.find((cell) => cell.date === date);
    const availableRooms = targetCell && Array.isArray(targetCell.availableRooms) ? targetCell.availableRooms : [];
    if (status === 'expired') {
      wx.showToast({ title: '该时段已过期', icon: 'none' });
      return;
    }
    if (status === 'full') {
      wx.showToast({ title: '该时段已约满', icon: 'none' });
      return;
    }
    const preferredRoom = availableRooms.includes(this.data.selectedRoom)
      ? this.data.selectedRoom
      : availableRooms[0];
    const selectedRoomDetail = this.data.roomDetails.find((item) => item.name === preferredRoom) || null;
    this.setData({
      selectedDate: date,
      selectedRoom: preferredRoom || '',
      selectedTimeSlot: timeslot,
      selectedRoomDetail
    });
    this.loadReservations(date);
    this.computeTimeSlotViews();
    wx.showToast({ title: '已带入可用时段', icon: 'success' });
  },

  inputPurpose: function(e) {
    const val = e.detail.value
    this.setData({
      purpose: val,
      purposeLength: val.length
    });
  },

  formatNowText: function() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
  },

  loadReservations: function(date) {
    const that = this;
    this.setData({
      loading: true
    });

    wx.cloud.callFunction({
      name: 'getReservationsByDate',
      data: {
        date: date
      },
      success: res => {
        that.setData({
          reservations: res.result.reservations || [],
          loading: false
        });
        that.computeTimeSlotViews();
      },
      fail: err => {
        console.error('加载预约失败', err);
        that.setData({
          loading: false
        });
        wx.showToast({
          title: '加载失败',
          icon: 'none'
        });
      }
    });
  },

  isTimeSlotReserved: function(room, timeSlot) {
    return this.data.reservations.some(r =>
      r.room === room &&
      r.time_slot === timeSlot &&
      r.status === 'pending'
    );
  },

  getSlotReservation: function(room, timeSlot) {
    return this.data.reservations.find(r =>
      r.room === room &&
      r.time_slot === timeSlot &&
      r.status === 'pending'
    );
  },

  isTimeSlotFull: function(timeSlot) {
    return this.data.rooms.every((room) => this.isTimeSlotReserved(room, timeSlot));
  },

  isTimeSlotExpired: function(date, timeSlot) {
    const now = new Date();
    const [startTime] = timeSlot.split('-');
    const [hour, minute] = startTime.split(':').map(Number);

    const slotTime = new Date(`${date}T00:00:00`);
    if (Number.isNaN(slotTime.getTime())) {
      return false;
    }
    slotTime.setHours(hour, minute, 0, 0);

    return slotTime <= now;
  },

  computeTimeSlotViews: function() {
    const selectedDate = this.data.selectedDate;
    const selectedRoom = this.data.selectedRoom;
    const selectedTimeSlot = this.data.selectedTimeSlot;
    const views = this.data.timeSlots.map((slot) => {
      const isExpired = selectedDate ? this.isTimeSlotExpired(selectedDate, slot) : false;
      const isFull = this.isTimeSlotFull(slot);
      const reservation = selectedRoom ? this.getSlotReservation(selectedRoom, slot) : null;
      const isReserved = !!reservation;
      const classes = ['timeslot-item'];
      if (selectedTimeSlot === slot) {
        classes.push('selected');
      }
      if (isExpired) {
        classes.push('expired');
      } else if (isFull) {
        classes.push('full');
      } else if (isReserved) {
        classes.push('reserved');
      }
      return {
        slot,
        className: classes.join(' '),
        isExpired,
        isFull,
        isReserved,
        isSelected: selectedTimeSlot === slot,
        reserverName: reservation ? (reservation.user_name || '已预约') : ''
      };
    });
    this.setData({
      timeSlotViews: views
    });
  },

  confirmReserve: function() {
    const { selectedDate, selectedRoom, selectedTimeSlot, purpose } = this.data;

    if (!this.data.isBound) {
      wx.showToast({
        title: '请先绑定手机号',
        icon: 'none'
      });
      return;
    }

    if (this.data.userStatus === 'disabled') {
      wx.showToast({
        title: '账户已被禁用，请联系处理人员',
        icon: 'none'
      });
      return;
    }

    if (this.data.remainingCount <= 0) {
      wx.showToast({
        title: '本周预约次数已用完',
        icon: 'none'
      });
      return;
    }

    if (!selectedDate || !selectedRoom || !selectedTimeSlot) {
      wx.showToast({
        title: '请选择完整信息',
        icon: 'none'
      });
      return;
    }

    if (this.isTimeSlotExpired(selectedDate, selectedTimeSlot)) {
      wx.showToast({
        title: '该时段已过期',
        icon: 'none'
      });
      return;
    }

    if (this.isTimeSlotFull(selectedTimeSlot)) {
      wx.showToast({
        title: '该时段已满',
        icon: 'none'
      });
      return;
    }

    if (this.isTimeSlotReserved(selectedRoom, selectedTimeSlot)) {
      wx.showToast({
        title: '该时段已被预约',
        icon: 'none'
      });
      return;
    }

    wx.showModal({
      title: '确认预约',
      content: `预约信息：\n日期：${selectedDate}\n会议室：${selectedRoom}\n时段：${selectedTimeSlot}\n用途：${purpose || '无'}`,
      success: (res) => {
        if (res.confirm) {
          this.doReserve();
        }
      }
    });
  },

  doReserve: function() {
    const that = this;
    const { selectedDate, selectedRoom, selectedTimeSlot, purpose } = this.data;

    wx.showLoading({
      title: '预约中...'
    });

    wx.cloud.callFunction({
      name: 'reserveRoom',
      data: {
        date: selectedDate,
        room: selectedRoom,
        timeSlot: selectedTimeSlot,
        purpose: purpose
      },
      success: res => {
        wx.hideLoading();
        console.log('reserveRoom result', res);
        if (res.result.success) {
          that.setData({
            remainingCount: Math.max(0, that.data.remainingCount - 1),
            showVoucher: true,
            reservationVoucher: {
              reservationId: res.result.reservationId || '--',
              date: selectedDate,
              room: selectedRoom,
              timeSlot: selectedTimeSlot,
              purpose: purpose || '未填写',
              statusText: '已预约',
              createdAtText: that.formatNowText()
            }
          });
          that.loadWeeklyAvailability();
          that.loadReservations(selectedDate);
        } else {
          const msg = (res.result && (res.result.message || res.result.error)) || '预约失败';
          wx.showToast({
            title: msg,
            icon: 'none'
          });
        }
      },
      fail: err => {
        wx.hideLoading();
        console.error('预约失败', err);
        wx.showToast({
          title: '预约失败',
          icon: 'none'
        });
      }
    });
  },

  closeVoucher: function() {
    this.setData({
      showVoucher: false,
      selectedTimeSlot: '',
      purpose: '',
      purposeLength: 0
    });
    this.computeTimeSlotViews();
  },

  goVoucherHome: function() {
    this.setData({ showVoucher: false });
    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  goVoucherReservations: function() {
    this.setData({ showVoucher: false });
    wx.switchTab({
      url: '/pages/myReservations/myReservations'
    });
  }
});
