const app = getApp()
const db = wx.cloud.database()

const CATEGORY_OPTIONS = [
  { name: '手工体验', desc: '体验课、手作活动' },
  { name: '非遗摆件', desc: '陈设器物、案头摆件' },
  { name: '地道风物', desc: '地方特产、风味好物' },
  { name: '文房雅器', desc: '笔墨纸砚、雅致器具' },
  { name: '服饰配件', desc: '穿戴饰品、日常配搭' },
  { name: '家居装饰', desc: '家居陈设、空间点缀' },
  { name: '文创礼品', desc: '伴手礼、纪念礼品' },
  { name: '其他', desc: '暂未归类的作品' }
]

const DELIVERY_METHOD_OPTIONS = [
  { value: 'express', name: '快递发货' },
  { value: 'pickup', name: '同城自提' },
  { value: 'heavy_cargo', name: '专线物流(大件)' }
]

const POSTAGE_OPTIONS = [
  { value: 'free', name: '全国包邮' },
  { value: 'pay_on_delivery', name: '邮费到付' }
]

const CARRIER_OPTIONS = [
  { value: 'sf_jd', name: '顺丰/京东', desc: '偏快，时效稳定' },
  { value: 'standard', name: '三通一达', desc: '常规快递渠道' },
  { value: 'post', name: '中国邮政', desc: '覆盖范围较广' },
  { value: 'heavy_cargo', name: '大件物流', desc: '适合器物、家具等' },
  { value: 'others', name: '视情况而定', desc: '按实际订单安排' }
]

const HANDLING_TIME_OPTIONS = [
  { value: '24h', name: '24小时内', desc: '当天或次日打包发出' },
  { value: '48h', name: '48小时内', desc: '预留基础备货时间' },
  { value: '3d', name: '3天内', desc: '适合手工整理与复检' },
  { value: '7d', name: '7天内', desc: '适合产地调货或集中备货' },
  { value: 'custom_15d', name: '接单定制(约15天)', desc: '需按订单制作' }
]

function getInputValue(e) {
  if (!e) return ''
  if (e.detail && typeof e.detail.value !== 'undefined') return e.detail.value
  if (typeof e.detail !== 'undefined') return e.detail
  return ''
}

function formatFenToInput(fen) {
  if (!fen && fen !== 0) return ''
  const yuan = Number(fen) / 100
  return yuan.toFixed(2).replace(/\.?0+$/, '')
}

function createEmptySku(defaultName = '默认款式') {
  return {
    skuId: '',
    skuName: defaultName,
    price: '',
    originalPrice: '',
    stock: '',
    image: ''
  }
}

function normalizeSkuForm(item, index) {
  return {
    skuId: item && item.sku_id ? String(item.sku_id) : '',
    skuName: item && item.sku_name ? String(item.sku_name) : (index === 0 ? '默认款式' : ''),
    price: formatFenToInput(item && item.price),
    originalPrice: formatFenToInput(item && (item.original_price || item.price)),
    stock: item && (item.stock || item.stock === 0) ? String(item.stock) : '',
    image: item && item.image ? String(item.image) : ''
  }
}

function normalizeLogisticsState(logistics = {}) {
  const method = logistics && logistics.method ? logistics.method : 'express'
  const normalized = {
    deliveryMethod: method,
    postage: logistics && logistics.postage ? logistics.postage : 'free',
    carrier: logistics && logistics.carrier ? logistics.carrier : 'sf_jd'
  }

  if (method === 'pickup') {
    normalized.postage = 'free'
    normalized.carrier = 'pickup'
  } else if (method === 'heavy_cargo') {
    normalized.carrier = 'heavy_cargo'
  } else if (normalized.carrier === 'pickup' || normalized.carrier === 'heavy_cargo') {
    normalized.carrier = 'sf_jd'
  }

  return normalized
}

Page({
  data: {
    title: '',
    intro: '',
    category: '',
    skus: [createEmptySku()],
    deliveryMethod: 'express',
    postage: 'free',
    carrier: 'sf_jd',
    handlingTime: '48h',
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
    deliveryMethodOptions: DELIVERY_METHOD_OPTIONS,
    postageOptions: POSTAGE_OPTIONS,
    carrierOptions: CARRIER_OPTIONS,
    handlingTimeOptions: HANDLING_TIME_OPTIONS,
    showCarrierPicker: false,
    showHandlingTimePicker: false,
    showProjectPicker: false,
    projectAllList: [],
    projectFilteredList: [],
    projectSearchKeyword: '',
    loadingProjects: false,
    projectEmpty: false,
    projectLoadFailed: false,
    submitting: false,
    safeAreaBottom: 0,
    pageTitle: '发布商品',
    submitText: '发布商品',
    submittingText: '发布中...',
    isEditMode: false,
    editProductId: '',
    originalIsOnSale: true
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({
      safeAreaBottom: systemInfo.safeArea ? (systemInfo.screenHeight - systemInfo.safeArea.bottom) : 0
    })
    this.loadProjectsFromDB()

    const productId = options.product_id || options.id || ''
    if (productId) {
      this.setData({
        isEditMode: true,
        editProductId: productId,
        pageTitle: '编辑商品',
        submitText: '保存修改',
        submittingText: '保存中...'
      })
      this.loadProductForEdit(productId)
    }
  },

  async loadProductForEdit(productId) {
    wx.showLoading({ title: '加载商品中...', mask: true })
    try {
      const res = await db.collection('shopping_products').doc(productId).get()
      const product = res.data

      if (!product) {
        throw new Error('商品不存在')
      }

      if (product.author_id !== app.globalData.openid) {
        throw new Error('无权编辑该商品')
      }

      const skus = Array.isArray(product.skus) && product.skus.length
        ? product.skus.map((item, index) => normalizeSkuForm(item, index))
        : [createEmptySku()]

      const logisticsState = normalizeLogisticsState(product.logistics || {})

      this.setData({
        title: product.title || '',
        intro: product.intro || '',
        category: product.category || '',
        skus,
        deliveryMethod: logisticsState.deliveryMethod,
        postage: logisticsState.postage,
        carrier: logisticsState.carrier,
        handlingTime: product.logistics && product.logistics.handling_time ? product.logistics.handling_time : '48h',
        projectId: product.related_project_id || '',
        projectName: product.related_project_name || '',
        origin: product.origin || '',
        imageFiles: (product.detail_imgs || []).map((url, index) => ({
          url,
          name: `img_${index}`
        })),
        selectedTags: Array.isArray(product.tags) ? product.tags : [],
        newTopics: [],
        originalIsOnSale: product.is_on_sale !== false
      })
    } catch (err) {
      console.error('加载编辑商品失败:', err)
      wx.showToast({ title: err.message || '商品加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
    } finally {
      wx.hideLoading()
    }
  },

  onTitleInput(e) {
    this.setData({ title: getInputValue(e) })
  },

  onIntroInput(e) {
    this.setData({ intro: getInputValue(e) })
  },

  onOriginInput(e) {
    this.setData({ origin: getInputValue(e) })
  },

  updateSkuField(index, field, value) {
    const skus = this.data.skus.slice()
    if (!skus[index]) return
    skus[index][field] = value
    this.setData({ skus })
  },

  onSkuFieldInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.updateSkuField(Number(index), field, getInputValue(e))
  },

  addSku() {
    const skus = this.data.skus.concat(createEmptySku(`款式 ${this.data.skus.length + 1}`))
    this.setData({ skus })
  },

  removeSku(e) {
    const index = Number(e.currentTarget.dataset.index)
    const skus = this.data.skus.slice()
    const target = skus[index]
    if (!target) return

    if (skus.length <= 1) {
      wx.showToast({ title: '至少保留一个 SKU', icon: 'none' })
      return
    }

    if (target.skuId) {
      wx.showToast({ title: '已发布 SKU 不允许删除，请将库存改为 0', icon: 'none' })
      return
    }

    skus.splice(index, 1)
    this.setData({ skus })
  },

  async uploadImage(filePath, folder = 'products') {
    const ext = (filePath.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '') || 'jpg'
    const cloudPath = `${folder}/${Date.now()}_${Math.floor(Math.random() * 100000)}.${ext}`
    const res = await wx.cloud.uploadFile({ cloudPath, filePath })
    return res.fileID
  },

  chooseImages() {
    const maxCount = 9 - this.data.imageFiles.length
    if (maxCount <= 0) {
      wx.showToast({ title: '最多上传 9 张图片', icon: 'none' })
      return
    }

    wx.chooseMedia({
      count: maxCount,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean)
        this.uploadChosenImages(files)
      }
    })
  },

  async uploadChosenImages(filePaths) {
    if (!filePaths.length) return

    wx.showLoading({ title: '上传中...', mask: true })
    try {
      const uploaded = await Promise.all(filePaths.map((filePath) => this.uploadImage(filePath, 'products')))
      const imageFiles = this.data.imageFiles.concat(uploaded.map((url, index) => ({
        url,
        name: `img_${Date.now()}_${index}`
      })))
      this.setData({ imageFiles })
      wx.showToast({ title: '上传成功', icon: 'success' })
    } catch (err) {
      console.error('图片上传失败:', err)
      wx.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  chooseSkuImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async (res) => {
        const filePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!filePath) return

        wx.showLoading({ title: '上传中...', mask: true })
        try {
          const fileID = await this.uploadImage(filePath, 'products/skus')
          this.updateSkuField(index, 'image', fileID)
          wx.showToast({ title: '上传成功', icon: 'success' })
        } catch (err) {
          console.error('SKU 图片上传失败:', err)
          wx.showToast({ title: '上传失败', icon: 'none' })
        } finally {
          wx.hideLoading()
        }
      }
    })
  },

  clearSkuImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.updateSkuField(index, 'image', '')
  },

  handleDeleteImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (Number.isNaN(index)) return
    const imageFiles = this.data.imageFiles.slice()
    imageFiles.splice(index, 1)
    this.setData({ imageFiles })
  },

  selectDeliveryMethod(e) {
    const value = e.currentTarget.dataset.value
    if (!value || value === this.data.deliveryMethod) return

    const updates = { deliveryMethod: value }
    if (value === 'pickup') {
      updates.postage = 'free'
      updates.carrier = 'pickup'
    } else if (value === 'heavy_cargo') {
      updates.carrier = 'heavy_cargo'
    } else if (this.data.carrier === 'pickup' || this.data.carrier === 'heavy_cargo') {
      updates.carrier = 'sf_jd'
    }

    this.setData(updates)
  },

  selectPostage(e) {
    const value = e.currentTarget.dataset.value
    if (this.data.deliveryMethod === 'pickup') return
    if (!value) return
    this.setData({ postage: value })
  },

  openCategoryPicker() {
    this.setData({ showCategoryPicker: true })
  },

  closeCategoryPicker() {
    this.setData({ showCategoryPicker: false })
  },

  selectCategory(e) {
    const category = this.data.categoryOptions[e.currentTarget.dataset.index]
    if (!category) return
    this.setData({
      category: category.name,
      showCategoryPicker: false
    })
  },

  openCarrierPicker() {
    if (this.data.deliveryMethod === 'pickup') return
    this.setData({ showCarrierPicker: true })
  },

  closeCarrierPicker() {
    this.setData({ showCarrierPicker: false })
  },

  selectCarrier(e) {
    const carrier = this.data.carrierOptions[e.currentTarget.dataset.index]
    if (!carrier) return
    this.setData({
      carrier: carrier.value,
      showCarrierPicker: false
    })
  },

  openHandlingTimePicker() {
    this.setData({ showHandlingTimePicker: true })
  },

  closeHandlingTimePicker() {
    this.setData({ showHandlingTimePicker: false })
  },

  selectHandlingTime(e) {
    const handlingTime = this.data.handlingTimeOptions[e.currentTarget.dataset.index]
    if (!handlingTime) return
    this.setData({
      handlingTime: handlingTime.value,
      showHandlingTimePicker: false
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
    const project = this.data.projectFilteredList[e.currentTarget.dataset.index]
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

      const limit = 20
      const tasks = []
      for (let index = 0; index < Math.ceil(total / limit); index += 1) {
        tasks.push(
          db.collection('ich_projects')
            .skip(index * limit)
            .limit(limit)
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

    return list.filter((item) => [item.name, item.category, item.city, item.level]
      .some((field) => String(field || '').toLowerCase().includes(normalizedKeyword)))
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
      wx.showToast({ title: '最多添加 10 个话题', icon: 'none' })
      return
    }

    selectedTags.push(tag)
    this.setData({ selectedTags })
  },

  removeTag(e) {
    const index = Number(e.currentTarget.dataset.index)
    const selectedTags = [...this.data.selectedTags]
    const removedTag = selectedTags[index]
    if (typeof removedTag === 'undefined') return

    selectedTags.splice(index, 1)
    const newTopics = this.data.newTopics.filter((item) => item !== removedTag)
    this.setData({ selectedTags, newTopics })
  },

  openTopicSearch() {
    if (this.data.selectedTags.length >= 10) {
      wx.showToast({ title: '最多添加 10 个话题', icon: 'none' })
      return
    }
    this.setData({ showTopicSearch: true })
  },

  closeTopicSearch() {
    this.setData({ showTopicSearch: false })
  },

  onTopicSelect(e) {
    const { name, isNew } = e.detail
    const selectedTags = [...this.data.selectedTags, name]
    const newTopics = isNew ? [...this.data.newTopics, name] : this.data.newTopics
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

  validateSkus() {
    const skus = this.data.skus || []
    if (!skus.length) {
      wx.showToast({ title: '请至少配置一个 SKU', icon: 'none' })
      return false
    }

    let totalStock = 0

    for (let index = 0; index < skus.length; index += 1) {
      const item = skus[index]
      const skuName = (item.skuName || '').trim() || (index === 0 ? '默认款式' : '')
      const price = Number(item.price)
      const originalPrice = item.originalPrice ? Number(item.originalPrice) : price
      const stock = Number(item.stock)

      if (!skuName) {
        wx.showToast({ title: `请填写第 ${index + 1} 个 SKU 名称`, icon: 'none' })
        return false
      }
      if (!price || price <= 0) {
        wx.showToast({ title: `请填写第 ${index + 1} 个 SKU 现价`, icon: 'none' })
        return false
      }
      if (!originalPrice || originalPrice < price) {
        wx.showToast({ title: `第 ${index + 1} 个 SKU 原价不能低于现价`, icon: 'none' })
        return false
      }
      if (!Number.isInteger(stock) || stock < 0) {
        wx.showToast({ title: `第 ${index + 1} 个 SKU 库存必须是非负整数`, icon: 'none' })
        return false
      }

      totalStock += stock
    }

    if (!this.data.isEditMode && totalStock <= 0) {
      wx.showToast({ title: '发布商品时总库存必须大于 0', icon: 'none' })
      return false
    }

    return true
  },

  validateForm() {
    const title = (this.data.title || '').trim()
    const intro = (this.data.intro || '').trim()
    const category = (this.data.category || '').trim()

    if (this.data.imageFiles.length === 0) {
      wx.showToast({ title: '请至少上传一张商品图片', icon: 'none' })
      return false
    }
    if (title.length < 5) {
      wx.showToast({ title: '商品标题至少 5 个字', icon: 'none' })
      return false
    }
    if (intro.length < 20) {
      wx.showToast({ title: '商品描述至少 20 个字', icon: 'none' })
      return false
    }
    if (!category) {
      wx.showToast({ title: '请选择商品分类', icon: 'none' })
      return false
    }
    if (!this.validateSkus()) {
      return false
    }
    if (!this.data.handlingTime) {
      wx.showToast({ title: '请选择备货时长', icon: 'none' })
      return false
    }
    if (this.data.deliveryMethod !== 'pickup' && !this.data.carrier) {
      wx.showToast({ title: '请选择默认物流', icon: 'none' })
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
        content: '只有认证传承人才可以发布商品',
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

  buildSkuPayload() {
    return this.data.skus.map((item, index) => {
      const skuName = (item.skuName || '').trim() || (index === 0 ? '默认款式' : '')
      const priceFen = Math.round(Number(item.price) * 100)
      const originalPriceYuan = item.originalPrice ? Number(item.originalPrice) : Number(item.price)
      const originalPriceFen = Math.round(originalPriceYuan * 100)

      return {
        sku_id: item.skuId || '',
        sku_name: skuName,
        price: priceFen,
        original_price: originalPriceFen,
        stock: Number(item.stock),
        image: item.image || ''
      }
    })
  },

  async submitProduct() {
    if (this.data.submitting) return
    if (!this.ensureCertified()) return
    if (!this.validateForm()) return

    this.setData({ submitting: true })
    wx.showLoading({ title: this.data.isEditMode ? '保存中...' : '发布中...', mask: true })

    try {
      await this.syncTopicsToDatabase()

      const skus = this.buildSkuPayload()
      const totalStock = skus.reduce((sum, item) => sum + item.stock, 0)
      const origin = this.data.origin.trim()
      const logistics = {
        method: this.data.deliveryMethod,
        postage: this.data.deliveryMethod === 'pickup' ? 'free' : this.data.postage,
        carrier: this.data.deliveryMethod === 'pickup' ? 'pickup' : this.data.carrier,
        handling_time: this.data.handlingTime,
        ship_from: origin || '湖南·长沙'
      }

      const result = await wx.cloud.callFunction({
        name: 'manage_shopping_product',
        data: {
          action: this.data.isEditMode ? 'update' : 'create',
          product_id: this.data.editProductId,
          payload: {
            title: this.data.title.trim(),
            intro: this.data.intro.trim(),
            category: this.data.category,
            skus,
            cover_img: this.data.imageFiles[0].url,
            detail_imgs: this.data.imageFiles.map((file) => file.url),
            related_project_id: this.data.projectId,
            related_project_name: this.data.projectName,
            origin,
            logistics,
            tags: [...this.data.selectedTags],
            is_on_sale: totalStock > 0 ? this.data.originalIsOnSale : false
          }
        }
      })

      wx.hideLoading()

      if (result.result && result.result.success) {
        wx.showToast({ title: this.data.isEditMode ? '保存成功' : '发布成功', icon: 'success' })
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/mall/detail?id=${result.result.product_id}` })
        }, 1200)
      } else {
        wx.showModal({
          title: this.data.isEditMode ? '保存失败' : '发布失败',
          content: (result.result && result.result.message) || '请稍后重试',
          showCancel: false,
          confirmColor: '#b63b36'
        })
      }
    } catch (err) {
      console.error('提交商品失败:', err)
      wx.hideLoading()
      wx.showModal({
        title: this.data.isEditMode ? '保存失败' : '发布失败',
        content: '网络异常，请稍后重试',
        showCancel: false,
        confirmColor: '#b63b36'
      })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
