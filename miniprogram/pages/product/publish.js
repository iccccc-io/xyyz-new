const app = getApp()
const db = wx.cloud.database()

const CATEGORY_OPTIONS = [
  { name: '手工体验', desc: '体验课、手作活动' },
  { name: '非遗摆件', desc: '陈设器物、案头摆件' },
  { name: '地道风物', desc: '地方特产、风味好物' },
  { name: '文房雅器', desc: '笔墨纸砚、雅致器具' },
  { name: '服饰配件', desc: '穿戴饰品、日常配搭' },
  { name: '家居装饰', desc: '家居陈设、空间点缀' },
  { name: '文创礼品', desc: '伴手礼、纪念礼物' },
  { name: '其他', desc: '暂未归类的作品' }
]

function getInputValue(e) {
  if (!e) return ''
  if (e.detail && typeof e.detail.value !== 'undefined') return e.detail.value
  if (typeof e.detail !== 'undefined') return e.detail
  return ''
}

Page({
  data: {
    title: '',
    intro: '',
    category: '',
    price: '',
    originalPrice: '',
    stock: '',
    projectId: '',
    projectName: '',
    origin: '',
    imageFiles: [],
    selectedTags: [],
    newTopics: [],
    showTopicSearch: false,
    recommendTags: ['非遗打卡', '周末去哪儿', '匠心', '手艺人', '传统文化'],
    showCategoryPicker: false,
    categoryOptions: CATEGORY_OPTIONS,
    showProjectPicker: false,
    projectAllList: [],
    projectFilteredList: [],
    projectSearchKeyword: '',
    loadingProjects: false,
    projectEmpty: false,
    projectLoadFailed: false,
    submitting: false,
    safeAreaBottom: 0
  },

  onLoad() {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      safeAreaBottom: systemInfo.safeArea ? (systemInfo.screenHeight - systemInfo.safeArea.bottom) : 0
    })
    this.loadProjectsFromDB()
  },

  onTitleInput(e) {
    this.setData({ title: getInputValue(e) })
  },

  onIntroInput(e) {
    this.setData({ intro: getInputValue(e) })
  },

  onPriceInput(e) {
    this.setData({ price: getInputValue(e) })
  },

  onOriginalPriceInput(e) {
    this.setData({ originalPrice: getInputValue(e) })
  },

  onStockInput(e) {
    this.setData({ stock: getInputValue(e) })
  },

  onOriginInput(e) {
    this.setData({ origin: getInputValue(e) })
  },

  openCategoryPicker() {
    this.setData({ showCategoryPicker: true })
  },

  closeCategoryPicker() {
    this.setData({ showCategoryPicker: false })
  },

  selectCategory(e) {
    const { index } = e.currentTarget.dataset
    const category = this.data.categoryOptions[index]
    if (!category) return
    this.setData({
      category: category.name,
      showCategoryPicker: false
    })
  },

  openProjectPicker() {
    this.setData({
      showProjectPicker: true,
      projectSearchKeyword: '',
      projectFilteredList: this.data.projectAllList
    })

    if (!this.data.projectAllList.length && !this.data.loadingProjects) {
      this.loadProjectsFromDB()
    }
  },

  closeProjectPicker() {
    this.setData({ showProjectPicker: false })
  },

  onProjectSearchInput(e) {
    const projectSearchKeyword = getInputValue(e).trim()
    this.setData({
      projectSearchKeyword,
      projectFilteredList: this.filterProjects(projectSearchKeyword)
    })
  },

  clearProjectSearch() {
    this.setData({
      projectSearchKeyword: '',
      projectFilteredList: this.data.projectAllList
    })
  },

  selectProjectFromPicker(e) {
    const { index } = e.currentTarget.dataset
    const project = this.data.projectFilteredList[index]
    if (!project) return

    this.setData({
      projectName: project.name,
      projectId: project.project_id,
      showProjectPicker: false
    })
  },

  async loadProjectsFromDB() {
    this.setData({ loadingProjects: true })
    try {
      const countRes = await db.collection('ich_projects').count()
      const total = countRes.total || 0

      if (!total) {
        this.setData({
          projectAllList: [],
          projectFilteredList: [],
          projectEmpty: true,
          projectLoadFailed: false
        })
        return
      }

      const MAX_LIMIT = 20
      const batchCount = Math.ceil(total / MAX_LIMIT)
      const tasks = []

      for (let i = 0; i < batchCount; i += 1) {
        tasks.push(
          db.collection('ich_projects')
            .skip(i * MAX_LIMIT)
            .limit(MAX_LIMIT)
            .field({ _id: true, project_id: true, title: true, name: true, category: true, city: true, level: true })
            .get()
        )
      }

      const results = await Promise.all(tasks)
      const projectMap = new Map()

      results.forEach((res) => {
        ;(res.data || []).forEach((item) => {
          const name = String(item.name || item.title || '').trim()
          const projectId = String(item.project_id || item._id || '').trim()
          if (!name || !projectId || projectMap.has(projectId)) return

          projectMap.set(projectId, {
            project_id: projectId,
            name,
            category: item.category ? String(item.category).trim() : '',
            city: item.city ? String(item.city).trim() : '',
            level: item.level ? String(item.level).trim() : ''
          })
        })
      })

      const projectAllList = Array.from(projectMap.values())
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))

      this.setData({
        projectAllList,
        projectFilteredList: this.filterProjects(this.data.projectSearchKeyword, projectAllList),
        projectEmpty: projectAllList.length === 0,
        projectLoadFailed: false
      })
    } catch (err) {
      console.error('加载非遗项目失败:', err)
      this.setData({
        projectAllList: [],
        projectFilteredList: [],
        projectEmpty: true,
        projectLoadFailed: true
      })
    } finally {
      this.setData({ loadingProjects: false })
    }
  },

  filterProjects(keyword, sourceList) {
    const list = Array.isArray(sourceList) ? sourceList : this.data.projectAllList
    const normalizedKeyword = String(keyword || '').trim().toLowerCase()
    if (!normalizedKeyword) return list

    return list.filter((item) => {
      const haystacks = [
        item.name,
        item.category,
        item.city,
        item.level
      ]
      return haystacks.some((field) => String(field || '').toLowerCase().includes(normalizedKeyword))
    })
  },

  async afterReadImage(e) {
    const files = Array.isArray(e.detail.file) ? e.detail.file : [e.detail.file]
    if (!files.length) return

    wx.showLoading({ title: '上传中...', mask: true })
    try {
      const tasks = files.map((file) => {
        // van-uploader 返回的临时路径在 file.url 中
        const filePath = file.url || file.tempFilePath || file.path
        const cloudPath = `products/${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`
        return wx.cloud.uploadFile({ cloudPath, filePath })
      })
      const results = await Promise.all(tasks)
      const newFiles = results.map((item, index) => ({
        url: item.fileID,
        name: `img_${Date.now()}_${index}`
      }))
      this.setData({
        imageFiles: this.data.imageFiles.concat(newFiles)
      })
      wx.showToast({ title: '上传成功', icon: 'success' })
    } catch (err) {
      console.error('图片上传失败:', err)
      wx.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 选择图片（替代 van-uploader）
  chooseImages() {
    const maxCount = 9 - this.data.imageFiles.length
    if (maxCount <= 0) {
      wx.showToast({ title: '最多上传9张图片', icon: 'none' })
      return
    }

    wx.chooseMedia({
      count: maxCount,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = res.tempFiles.map(f => ({ tempFilePath: f.tempFilePath }))
        this.uploadChosenImages(files)
      }
    })
  },

  // 上传选中的图片
  async uploadChosenImages(files) {
    if (!files.length) return

    wx.showLoading({ title: '上传中...', mask: true })
    try {
      const tasks = files.map((file) => {
        const filePath = file.tempFilePath
        const cloudPath = `products/${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`
        return wx.cloud.uploadFile({ cloudPath, filePath })
      })
      const results = await Promise.all(tasks)
      const newFiles = results.map((item, index) => ({
        url: item.fileID,
        name: `img_${Date.now()}_${index}`
      }))
      this.setData({
        imageFiles: this.data.imageFiles.concat(newFiles)
      })
      wx.showToast({ title: '上传成功', icon: 'success' })
    } catch (err) {
      console.error('图片上传失败:', err)
      wx.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // 自定义删除图片
  handleDeleteImage(e) {
    const index = e.currentTarget.dataset.index
    if (typeof index === 'number' && index >= 0 && index < this.data.imageFiles.length) {
      const imageFiles = this.data.imageFiles.slice()
      imageFiles.splice(index, 1)
      this.setData({ imageFiles })
      wx.showToast({ title: '已删除', icon: 'success', duration: 1000 })
    }
  },

  onDeleteImage(e) {
    // van-uploader 的 delete 事件备用
    const detail = e.detail || {}
    const index = detail.index
    if (typeof index === 'number' && index >= 0 && index < this.data.imageFiles.length) {
      const imageFiles = this.data.imageFiles.slice()
      imageFiles.splice(index, 1)
      this.setData({ imageFiles })
    }
  },

  togglePresetTag(e) {
    const tag = e.currentTarget.dataset.tag
    const selectedTags = [...this.data.selectedTags]
    const index = selectedTags.indexOf(tag)

    if (index > -1) {
      selectedTags.splice(index, 1)
      const newTopics = this.data.newTopics.filter((item) => item !== tag)
      this.setData({ selectedTags, newTopics })
      return
    }

    if (selectedTags.length >= 10) {
      wx.showToast({
        title: '最多添加10个话题',
        icon: 'none'
      })
      return
    }

    selectedTags.push(tag)
    this.setData({ selectedTags })
  },

  removeTag(e) {
    const index = e.currentTarget.dataset.index
    const selectedTags = [...this.data.selectedTags]
    const removedTag = selectedTags[index]
    if (typeof removedTag === 'undefined') return

    selectedTags.splice(index, 1)
    const newTopics = this.data.newTopics.filter((item) => item !== removedTag)
    this.setData({ selectedTags, newTopics })
  },

  openTopicSearch() {
    if (this.data.selectedTags.length >= 10) {
      wx.showToast({
        title: '最多添加10个话题',
        icon: 'none'
      })
      return
    }
    this.setData({ showTopicSearch: true })
  },

  closeTopicSearch() {
    this.setData({ showTopicSearch: false })
  },

  onTopicSelect(e) {
    const { name, isNew } = e.detail
    const selectedTags = [...this.data.selectedTags]
    const newTopics = [...this.data.newTopics]

    selectedTags.push(name)
    if (isNew) {
      newTopics.push(name)
    }

    this.setData({
      selectedTags,
      newTopics,
      showTopicSearch: false
    })
  },

  async syncTopicsToDatabase() {
    const selectedTags = this.data.selectedTags
    const newTopics = this.data.newTopics

    if (!selectedTags.length) return

    for (const tagName of selectedTags) {
      try {
        if (newTopics.includes(tagName)) {
          await db.collection('community_topics').add({
            data: {
              name: tagName,
              count: 1,
              create_time: db.serverDate()
            }
          })
        } else {
          const result = await wx.cloud.callFunction({
            name: 'update_stats',
            data: {
              collection: 'community_topics',
              whereField: 'name',
              whereValue: tagName,
              field: 'count',
              amount: 1
            }
          })

          if (result.result && result.result.updated === 0) {
            await db.collection('community_topics').add({
              data: {
                name: tagName,
                count: 1,
                create_time: db.serverDate()
              }
            })
          }
        }
      } catch (err) {
        console.warn('同步话题失败:', tagName, err)
      }
    }
  },

  validateForm() {
    const title = (this.data.title || '').trim()
    const intro = (this.data.intro || '').trim()
    const category = (this.data.category || '').trim()
    const price = Number(this.data.price)
    const originalPrice = this.data.originalPrice ? Number(this.data.originalPrice) : 0
    const stock = Number(this.data.stock)

    if (this.data.imageFiles.length === 0) {
      wx.showToast({ title: '请至少上传一张商品图片', icon: 'none' })
      return false
    }
    if (title.length < 5) {
      wx.showToast({ title: '商品标题至少5个字', icon: 'none' })
      return false
    }
    if (intro.length < 20) {
      wx.showToast({ title: '商品描述至少20字', icon: 'none' })
      return false
    }
    if (!category) {
      wx.showToast({ title: '请选择商品分类', icon: 'none' })
      return false
    }
    if (!price || price <= 0) {
      wx.showToast({ title: '请输入正确的现价（元）', icon: 'none' })
      return false
    }
    if (this.data.originalPrice && (!originalPrice || originalPrice < price)) {
      wx.showToast({ title: '原价应不低于现价', icon: 'none' })
      return false
    }
    if (!stock || stock <= 0 || !Number.isInteger(stock)) {
      wx.showToast({ title: '请输入正确的库存数量（正整数）', icon: 'none' })
      return false
    }
    if (!this.data.projectId) {
      wx.showToast({ title: '请选择关联的非遗项目', icon: 'none' })
      return false
    }
    return true
  },

  ensureCertified() {
    const userInfo = app.globalData.userInfo
    if (!userInfo) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return false
    }
    if (!userInfo.is_certified) {
      wx.showModal({
        title: '需要认证',
        content: '只有认证传承人才能发布商品',
        confirmText: '去认证',
        confirmColor: '#b63b36',
        success: (res) => {
          if (res.confirm) {
            wx.redirectTo({ url: '/pages/certification/apply' })
          }
        }
      })
      return false
    }
    return true
  },

  async submitProduct() {
    if (this.data.submitting) return
    if (!this.ensureCertified()) return
    if (!this.validateForm()) return

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中...', mask: true })

    try {
      const selectedTags = [...this.data.selectedTags]

      // 用户输入元，存储统一使用分（×100），严格遵守顶层设计规范
      const priceYuan = Number(this.data.price)
      const originalPriceYuan = this.data.originalPrice ? Number(this.data.originalPrice) : priceYuan
      const priceFen = Math.round(priceYuan * 100)
      const originalPriceFen = Math.round(originalPriceYuan * 100)

      await this.syncTopicsToDatabase()

      const result = await wx.cloud.callFunction({
        name: 'add_shopping_product',
        data: {
          title: this.data.title.trim(),
          intro: this.data.intro.trim(),
          category: this.data.category,
          price: priceFen,
          original_price: originalPriceFen,
          stock: Number(this.data.stock),
          cover_img: this.data.imageFiles[0].url,
          detail_imgs: this.data.imageFiles.map((file) => file.url),
          related_project_id: this.data.projectId,
          related_project_name: this.data.projectName,
          origin: this.data.origin.trim(),
          tags: selectedTags
        }
      })

      wx.hideLoading()

      if (result.result && result.result.success) {
        wx.showToast({ title: '发布成功', icon: 'success' })
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/mall/detail?id=${result.result.product_id}` })
        }, 1200)
      } else {
        wx.showModal({
          title: '发布失败',
          content: (result.result && result.result.message) || '发布失败，请稍后重试',
          showCancel: false,
          confirmColor: '#b63b36'
        })
      }
    } catch (err) {
      console.error('发布失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: '发布失败',
        content: '网络异常，请稍后重试',
        showCancel: false,
        confirmColor: '#b63b36'
      })
    } finally {
      this.setData({ submitting: false })
    }
  }
})

