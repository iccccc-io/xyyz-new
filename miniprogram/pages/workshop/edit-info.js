const app = getApp()

function getInputValue(e) {
  if (!e) return ''
  if (e.detail && typeof e.detail.value !== 'undefined') return e.detail.value
  if (typeof e.detail !== 'undefined') return e.detail
  return ''
}

function createUploadList(url = '', name = '') {
  return url
    ? [{ url, name: name || `file_${Date.now()}` }]
    : []
}

function getFileExtension(path) {
  const match = String(path || '').match(/(\.[a-zA-Z0-9]+)(?:$|\?)/)
  return match ? match[1].toLowerCase() : '.jpg'
}

Page({
  data: {
    loading: true,
    saving: false,
    workshopId: '',
    workshopName: '',
    workshopDesc: '',
    logoFiles: [],
    coverFiles: [],
    lastRenameTimeText: ''
  },

  onLoad(options) {
    const workshopId = options.id || app.globalData.userInfo && app.globalData.userInfo.workshop_id || ''
    if (!workshopId) {
      wx.showToast({ title: '未找到工坊信息', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }

    this.setData({ workshopId })
    this.loadWorkshopInfo()
  },

  formatDate(value) {
    if (!value) return ''
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  async loadWorkshopInfo() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_workshop_home',
        data: {
          action: 'get_info',
          workshop_id: this.data.workshopId
        }
      })

      const result = res.result
      if (!(result && result.success && result.workshop)) {
        throw new Error((result && result.message) || '工坊资料加载失败')
      }

      const workshop = result.workshop
      this.setData({
        loading: false,
        workshopName: workshop.name || '',
        workshopDesc: workshop.desc || '',
        logoFiles: createUploadList(workshop.logo, 'logo'),
        coverFiles: createUploadList(workshop.cover_url, 'cover'),
        lastRenameTimeText: this.formatDate(workshop.last_rename_time)
      })
    } catch (err) {
      console.error('[workshop/edit-info] loadWorkshopInfo failed:', err)
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  onWorkshopNameInput(e) {
    this.setData({ workshopName: getInputValue(e) })
  },

  onWorkshopDescInput(e) {
    this.setData({ workshopDesc: getInputValue(e) })
  },

  async chooseAndUploadImage(folder, stateKey, { replace = true } = {}) {
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      })
      const file = chooseRes.tempFiles && chooseRes.tempFiles[0]
      if (!file || !file.tempFilePath) return

      wx.showLoading({ title: '上传中...', mask: true })
      const ext = getFileExtension(file.tempFilePath)
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: `${folder}/${this.data.workshopId}_${Date.now()}${ext}`,
        filePath: file.tempFilePath
      })

      const current = replace ? [] : this.data[stateKey]
      this.setData({
        [stateKey]: current.concat({
          url: uploadRes.fileID,
          name: `${folder}_${Date.now()}`
        })
      })
      wx.hideLoading()
      wx.showToast({ title: '上传成功', icon: 'success' })
    } catch (err) {
      wx.hideLoading()
      if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) {
        return
      }
      console.error('[workshop/edit-info] upload failed:', err)
      wx.showToast({ title: '上传失败', icon: 'none' })
    }
  },

  chooseLogo() {
    this.chooseAndUploadImage('workshop-logos', 'logoFiles')
  },

  chooseCover() {
    this.chooseAndUploadImage('workshop-covers', 'coverFiles')
  },

  removeLogo() {
    this.setData({ logoFiles: [] })
  },

  removeCover() {
    this.setData({ coverFiles: [] })
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.previewImage({
      urls: [url],
      current: url
    })
  },

  validateForm() {
    const workshopName = (this.data.workshopName || '').trim()
    const workshopDesc = (this.data.workshopDesc || '').trim()
    const logo = this.data.logoFiles[0] && this.data.logoFiles[0].url

    if (workshopName.length < 2) {
      wx.showToast({ title: '请输入工坊名称', icon: 'none' })
      return false
    }
    if (!logo) {
      wx.showToast({ title: '请上传工坊 Logo', icon: 'none' })
      return false
    }
    if (workshopDesc.length < 10) {
      wx.showToast({ title: '主理人寄语至少10字', icon: 'none' })
      return false
    }
    return true
  },

  async submit() {
    if (this.data.saving) return
    if (!this.validateForm()) return

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...', mask: true })

    try {
      const res = await wx.cloud.callFunction({
        name: 'manage_workshop_home',
        data: {
          action: 'update_info',
          workshop_id: this.data.workshopId,
          name: this.data.workshopName.trim(),
          logo: this.data.logoFiles[0].url,
          desc: this.data.workshopDesc.trim(),
          cover_url: this.data.coverFiles[0] ? this.data.coverFiles[0].url : ''
        }
      })

      wx.hideLoading()
      const result = res.result
      if (!(result && result.success && result.workshop)) {
        wx.showToast({ title: (result && result.message) || '保存失败', icon: 'none' })
        this.setData({ saving: false })
        return
      }

      this.setData({
        saving: false,
        lastRenameTimeText: this.formatDate(result.workshop.last_rename_time)
      })
      wx.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack()
      }, 900)
    } catch (err) {
      wx.hideLoading()
      console.error('[workshop/edit-info] submit failed:', err)
      this.setData({ saving: false })
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  }
})
