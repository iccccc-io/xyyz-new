// pages/address/edit.js
const app = getApp()
const db = wx.cloud.database()

Page({
  data: {
    isEdit: false,
    editId: '',
    saving: false,
    form: {
      name: '',
      phone: '',
      province: '',
      city: '',
      district: '',
      detail: '',
      is_default: false
    },
    regionValue: [],
    regionDisplay: ''
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ isEdit: true, editId: options.id })
      this.loadAddress(options.id)
    }
  },

  /** 编辑模式：加载已有地址 */
  async loadAddress(id) {
    try {
      const res = await db.collection('shopping_addresses').doc(id).get()
      const addr = res.data
      if (!addr) return

      this.setData({
        form: {
          name: addr.name || '',
          phone: addr.phone || '',
          province: addr.province || '',
          city: addr.city || '',
          district: addr.district || '',
          detail: addr.detail || '',
          is_default: !!addr.is_default
        },
        regionValue: [addr.province || '', addr.city || '', addr.district || ''],
        regionDisplay: addr.province && addr.city
          ? `${addr.province} ${addr.city} ${addr.district || ''}`
          : ''
      })
    } catch (err) {
      console.error('加载地址失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onNameInput(e) { this.setData({ 'form.name': e.detail.value }) },
  onPhoneInput(e) { this.setData({ 'form.phone': e.detail.value }) },
  onDetailInput(e) { this.setData({ 'form.detail': e.detail.value }) },

  /** 省市区选择器确认 */
  onRegionChange(e) {
    const [province, city, district] = e.detail.value
    this.setData({
      'form.province': province,
      'form.city': city,
      'form.district': district,
      regionValue: [province, city, district],
      regionDisplay: `${province} ${city} ${district}`
    })
  },

  /** 默认地址开关 */
  onDefaultChange(e) {
    this.setData({ 'form.is_default': e.detail })
  },

  /** 保存地址 */
  async saveAddress() {
    const { form, isEdit, editId, saving } = this.data
    if (saving) return

    // ===== 校验 =====
    if (!form.name || form.name.trim().length < 1) {
      wx.showToast({ title: '请输入收货人姓名', icon: 'none' }); return
    }
    if (!/^1\d{10}$/.test(form.phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' }); return
    }
    if (!form.province || !form.city) {
      wx.showToast({ title: '请选择所在地区', icon: 'none' }); return
    }
    if (!form.detail || form.detail.trim().length < 3) {
      wx.showToast({ title: '详细地址至少 3 个字', icon: 'none' }); return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...', mask: true })

    const openid = app.globalData.openid

    try {
      // 设为默认时，先清除旧的默认
      if (form.is_default) {
        await this._clearOtherDefaults(openid, isEdit ? editId : null)
      }

      const data = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        province: form.province,
        city: form.city,
        district: form.district || '',
        detail: form.detail.trim(),
        is_default: form.is_default,
        update_time: db.serverDate()
      }

      if (isEdit) {
        await db.collection('shopping_addresses').doc(editId).update({ data })
      } else {
        data.create_time = db.serverDate()
        await db.collection('shopping_addresses').add({ data })
      }

      wx.hideLoading()
      this.setData({ saving: false })
      wx.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (err) {
      wx.hideLoading()
      this.setData({ saving: false })
      console.error('保存地址失败:', err)
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  },

  /**
   * 清除其他地址的默认标记
   * @param {string} openid
   * @param {string|null} excludeId 编辑时排除自身
   */
  async _clearOtherDefaults(openid, excludeId) {
    try {
      const res = await db.collection('shopping_addresses')
        .where({ _openid: openid, is_default: true })
        .get()

      const tasks = (res.data || [])
        .filter(a => a._id !== excludeId)
        .map(a =>
          db.collection('shopping_addresses').doc(a._id).update({
            data: { is_default: false, update_time: db.serverDate() }
          })
        )

      if (tasks.length > 0) await Promise.all(tasks)
    } catch (err) {
      console.warn('清除默认地址失败:', err)
    }
  }
})
