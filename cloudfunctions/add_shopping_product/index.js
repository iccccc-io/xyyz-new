// 云函数入口文件 - 商品上架
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

/**
 * 商品上架云函数
 * 
 * 功能：
 * 1. 内容安全审核（文字 + 图片）
 * 2. 自动绑定 author_id 和 workshop_id
 * 3. 初始化销量和状态
 * 4. 保存商品到 shopping_products 集合
 * 
 * @param {Object} event - 请求参数
 * @param {String} event.title - 商品标题
 * @param {String} event.intro - 商品描述
 * @param {String} event.category - 商品分类
 * @param {Number} event.price - 商品价格（分）
 * @param {Number} event.original_price - 原价（分）
 * @param {Number} event.stock - 库存数量
 * @param {String} event.cover_img - 封面图云存储ID
 * @param {Array} event.detail_imgs - 详情图数组
 * @param {String} event.related_project_id - 关联非遗项目ID
 * @param {String} event.related_project_name - 关联非遗项目名称
 * @param {String} event.origin - 产地信息
 * @param {Object} event.logistics - 物流信息
 * @param {Array} event.tags - 标签数组
 * 
 * @returns {Object} { success: Boolean, message: String, product_id: String }
 */
exports.main = async (event, context) => {
  const {
    title,
    intro,
    category,
    price,
    original_price,
    stock,
    cover_img,
    detail_imgs,
    related_project_id,
    related_project_name,
    origin,
    logistics,
    tags
  } = event
  
  // 获取调用者 openid
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  console.log(`[商品上架] 用户 ${openid} 发起商品上架请求`)

  // ========== 参数校验 ==========
  if (!title || !intro || !category || !price || !stock || !cover_img) {
    return {
      success: false,
      message: '参数错误：标题、描述、分类、价格、库存和封面图为必填项'
    }
  }

  if (title.length > 40) {
    return {
      success: false,
      message: '商品标题不能超过40个字符'
    }
  }

  // price 单位为分（整数），最低1分；stock 为正整数
  if (!Number.isInteger(price) || price < 1) {
    return {
      success: false,
      message: '价格参数异常（单位：分，最低1分）'
    }
  }

  if (!Number.isInteger(stock) || stock < 1) {
    return {
      success: false,
      message: '库存必须是正整数'
    }
  }

  if (!detail_imgs || !Array.isArray(detail_imgs) || detail_imgs.length === 0) {
    return {
      success: false,
      message: '请至少上传一张详情图'
    }
  }

  try {
    // ========== 1. 查询用户信息，获取工坊ID ==========
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .get()

    if (!userRes.data || userRes.data.length === 0) {
      return {
        success: false,
        message: '用户信息不存在'
      }
    }

    const user = userRes.data[0]
    
    if (!user.is_certified) {
      return {
        success: false,
        message: '您还不是认证传承人，无权发布商品'
      }
    }

    if (!user.workshop_id) {
      return {
        success: false,
        message: '您还没有创建工坊，请先完成认证'
      }
    }

    // ========== 2. 内容安全审核 ==========
    console.log('[商品上架] 开始内容安全审核...')
    
    // 2.1 文字审核 - 标题
    try {
      const titleCheckRes = await cloud.openapi.security.msgSecCheck({
        content: title
      })
      console.log('[内容审核] 标题审核结果:', titleCheckRes)
      
      if (titleCheckRes.errCode !== 0) {
        return {
          success: false,
          message: '商品标题包含敏感信息，请修改后重试'
        }
      }
    } catch (err) {
      console.warn('[内容审核] 标题审核失败:', err)
      // 审核接口异常时不阻塞流程，记录日志
      if (err.errCode === 87014) {
        return {
          success: false,
          message: '商品标题包含违规内容'
        }
      }
    }
    
    // 2.2 文字审核 - 描述
    try {
      const introCheckRes = await cloud.openapi.security.msgSecCheck({
        content: intro
      })
      console.log('[内容审核] 描述审核结果:', introCheckRes)
      
      if (introCheckRes.errCode !== 0) {
        return {
          success: false,
          message: '商品描述包含敏感信息，请修改后重试'
        }
      }
    } catch (err) {
      console.warn('[内容审核] 描述审核失败:', err)
      if (err.errCode === 87014) {
        return {
          success: false,
          message: '商品描述包含违规内容'
        }
      }
    }

    // 2.3 图片审核 - 封面图
    try {
      const coverImgCheckRes = await cloud.openapi.security.imgSecCheck({
        media: {
          contentType: 'image/png',
          value: Buffer.from(cover_img)
        }
      })
      console.log('[内容审核] 封面图审核结果:', coverImgCheckRes)
      
      if (coverImgCheckRes.errCode !== 0) {
        return {
          success: false,
          message: '封面图包含违规内容'
        }
      }
    } catch (err) {
      console.warn('[内容审核] 封面图审核失败:', err)
      // 图片审核失败时，只记录日志，不阻塞流程
    }

    console.log('[商品上架] 内容安全审核通过')

    // ========== 3. 构建商品数据 ==========
    const logisticsMethod = logistics && typeof logistics.method === 'string' ? logistics.method : 'express'
    const logisticsPostage = logistics && typeof logistics.postage === 'string' ? logistics.postage : 'free'
    const logisticsCarrier = logistics && typeof logistics.carrier === 'string'
      ? logistics.carrier
      : (logisticsMethod === 'pickup' ? 'pickup' : 'sf_jd')
    const handlingTime = logistics && typeof logistics.handling_time === 'string'
      ? logistics.handling_time
      : '48h'
    const shipFrom = logistics && typeof logistics.ship_from === 'string'
      ? logistics.ship_from.trim()
      : (origin || '').trim()

    const productData = {
      title: title,
      intro: intro,
      category: category,
      price: Number(price),
      original_price: original_price ? Number(original_price) : Number(price),
      stock: Number(stock),
      cover_img: cover_img,
      detail_imgs: detail_imgs,
      related_project_id: related_project_id || '',
      related_project_name: related_project_name || '',
      origin: origin || '',
      logistics: {
        method: logisticsMethod,
        postage: logisticsPostage,
        carrier: logisticsMethod === 'pickup' ? 'pickup' : logisticsCarrier,
        handling_time: handlingTime,
        ship_from: shipFrom || '湖南·长沙'
      },
      tags: tags || [],
      
      // 自动绑定字段
      author_id: openid,
      workshop_id: user.workshop_id,
      
      // 初始化字段
      sales: 0,
      status: 1, // 1=已上架，0=已下架
      
      // 时间戳
      create_time: db.serverDate(),
      update_time: db.serverDate()
    }

    // ========== 4. 插入商品数据 ==========
    const productRes = await db.collection('shopping_products').add({
      data: productData
    })

    const productId = productRes._id
    console.log(`[商品上架] 商品已创建，ID: ${productId}`)

    // ========== 5. 更新工坊商品数量 ==========
    await db.collection('shopping_workshops')
      .doc(user.workshop_id)
      .update({
        data: {
          product_count: db.command.inc(1),
          update_time: db.serverDate()
        }
      })

    console.log(`[商品上架] 工坊 ${user.workshop_id} 商品数量已更新`)

    // ========== 6. 返回成功结果 ==========
    return {
      success: true,
      message: '商品发布成功',
      product_id: productId
    }

  } catch (err) {
    console.error('[商品上架失败]', err)
    return {
      success: false,
      message: `商品发布失败: ${err.message || '未知错误'}`
    }
  }
}

