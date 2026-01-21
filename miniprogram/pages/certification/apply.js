const app = getApp()

const CATEGORY_OPTIONS = [
  '湘绣',
  '滩头年画',
  '长沙花鼓戏',
  '苗族银饰',
  '湘西苗族鼓舞',
  '土家族织锦',
  '醴陵釉下五彩瓷',
  '湘西竹编',
  '桃源刺绣',
  '其他'
]

Page({
  data: {
    realName: '',
    ichCategory: '',
    bio: '',
    certFiles: [],
    showCategorySheet: false,
    categoryActions: CATEGORY_OPTIONS.map((name) => ({ name })),
    submitting: false
  },

  onRealNameInput(e) {
    this.setData({ realName: e.detail })
  },

  onBioInput(e) {
    this.setData({ bio: e.detail })
  },

  openCategorySheet() {
    this.setData({ showCategorySheet: true })
  },

  onCloseCategorySheet() {
    this.setData({ showCategorySheet: false })
  },

  onSelectCategory(e) {
    const { name } = e.detail || {}
    if (!name) return
    this.setData({
      ichCategory: name,
      showCategorySheet: false
    })
  },

  // 选择证书图片
  chooseCertImages() {
    const maxCount = 3 - this.data.certFiles.length
    if (maxCount <= 0) {
      wx.showToast({ title: '最多上传3张证书', icon: 'none' })
      return
    }

    wx.chooseMedia({
      count: maxCount,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = res.tempFiles.map(f => ({ tempFilePath: f.tempFilePath }))
        this.uploadCertImages(files)
      }
    })
  },

  // 上传证书图片
  async uploadCertImages(files) {
    if (!files.length) return

    wx.showLoading({ title: '上传中...', mask: true })
    try {
      const tasks = files.map((file) => {
        const filePath = file.tempFilePath
        const cloudPath = `certificates/${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`
        return wx.cloud.uploadFile({ cloudPath, filePath })
      })
      const results = await Promise.all(tasks)
      const newFiles = results.map((item, index) => ({
        url: item.fileID,
        name: `cert_${Date.now()}_${index}`
      }))
      this.setData({
        certFiles: this.data.certFiles.concat(newFiles)
      })
      wx.showToast({ title: '上传成功', icon: 'success' })
    } catch (err) {
      console.error('证书上传失败:', err)
      wx.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 自定义删除证书
  handleDeleteCert(e) {
    const index = e.currentTarget.dataset.index
    if (typeof index === 'number' && index >= 0 && index < this.data.certFiles.length) {
      const certFiles = this.data.certFiles.slice()
      certFiles.splice(index, 1)
      this.setData({ certFiles })
      wx.showToast({ title: '已删除', icon: 'success', duration: 1000 })
    }
  },

  // van-uploader 备用
  async afterReadCert(e) {
    const files = Array.isArray(e.detail.file) ? e.detail.file : [e.detail.file]
    if (!files.length) return
    const mapped = files.map(f => ({ tempFilePath: f.url || f.tempFilePath || f.path }))
    this.uploadCertImages(mapped)
  },

  onDeleteCert(e) {
    const { index } = e.detail || {}
    if (typeof index === 'number' && index >= 0) {
      this.handleDeleteCert({ currentTarget: { dataset: { index } } })
    }
  },

  validateForm() {
    const realName = (this.data.realName || '').trim()
    const ichCategory = (this.data.ichCategory || '').trim()
    const bio = (this.data.bio || '').trim()

    if (realName.length < 2) {
      wx.showToast({ title: '请输入真实姓名（至少2个字）', icon: 'none' })
      return false
    }
    if (!ichCategory) {
      wx.showToast({ title: '请选择非遗类别', icon: 'none' })
      return false
    }
    if (this.data.certFiles.length === 0) {
      wx.showToast({ title: '请至少上传一张证书', icon: 'none' })
      return false
    }
    if (bio.length < 50) {
      wx.showToast({ title: '工坊简介至少50字', icon: 'none' })
      return false
    }
    return true
  },

  async submitApplication() {
    if (this.data.submitting) return
    if (!this.validateForm()) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中...', mask: true })

    try {
      const result = await wx.cloud.callFunction({
        name: 'apply_certification',
        data: {
          real_name: this.data.realName.trim(),
          ich_category: this.data.ichCategory,
          certificates: this.data.certFiles.map((file) => file.url),
          bio: this.data.bio.trim()
        }
      })

      wx.hideLoading()

      if (result.result && result.result.success) {
        if (app.globalData.userInfo) {
          app.globalData.userInfo.is_certified = true
          app.globalData.userInfo.workshop_id = result.result.workshop_id
          app.globalData.userInfo.real_name = this.data.realName.trim()
          app.globalData.userInfo.ich_category = this.data.ichCategory
          app.globalData.userInfo.bio = this.data.bio.trim()
        }

        wx.showModal({
          title: '认证成功',
          content: '系统已为您初始化工坊，可进入工坊查看。',
          confirmText: '进入工坊',
          confirmColor: '#b63b36',
          showCancel: false,
          success: () => {
            wx.redirectTo({
              url: `/pages/workshop/index?id=${result.result.workshop_id}`
            })
          }
        })
      } else {
        wx.showModal({
          title: '申请失败',
          content: (result.result && result.result.message) || '申请失败，请稍后重试',
          showCancel: false,
          confirmColor: '#b63b36'
        })
      }
    } catch (err) {
      console.error('提交失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: '提交失败',
        content: '网络异常，请稍后重试',
        showCancel: false,
        confirmColor: '#b63b36'
      })
    } finally {
      this.setData({ submitting: false })
    }
  }
})

