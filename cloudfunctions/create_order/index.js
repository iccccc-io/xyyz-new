/**
 * 云函数：create_order
 * 管理员权限执行，解决买家无法更新卖家商品库存的权限问题
 *
 * 核心链路：
 * 1. 验证商品存在 & 上架 & 有库存
 * 2. 原子扣减库存（inc(-quantity)，数据库层面防超卖）
 * 3. 获取卖家信息（工坊 owner_id）
 * 4. 创建 shopping_orders 记录（status=10 待付款）
 * 5. 写入完整的商品快照 + 收货地址
 *
 * 如果步骤 4 失败，自动回滚步骤 2 的库存扣减
 *
 * --- 预留接口说明 ---
 * 上线后将此云函数作为「统一下单入口」，
 * 可在步骤 4 后追加调用微信支付统一下单 API（wx.requestPayment），
 * 将 prepay_id 返回给前端拉起支付，替换当前的模拟支付流程。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

function getSafeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSkuList(product) {
  return Array.isArray(product && product.skus) ? product.skus : []
}

function findSkuWithIndex(product, skuId) {
  const targetSkuId = getSafeString(skuId)
  const skus = normalizeSkuList(product)
  const index = skus.findIndex((item) => getSafeString(item && item.sku_id) === targetSkuId)
  if (index < 0) return { index: -1, sku: null }
  return { index, sku: skus[index] }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const {
    product_id,
    sku_id,
    quantity = 1,
    delivery_address
  } = event

  // ========== 参数校验 ==========
  if (!product_id) {
    return { success: false, message: '参数错误：缺少商品ID' }
  }
  if (!sku_id) {
    return { success: false, message: '参数错误：缺少款式ID' }
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { success: false, message: '购买数量不合法' }
  }
  if (!delivery_address || !delivery_address.userName || !delivery_address.telNumber) {
    return { success: false, message: '请选择收货地址' }
  }

  try {
    // ========== 1. 查询商品 ==========
    let productRes
    try {
      productRes = await db.collection('shopping_products').doc(product_id).get()
    } catch (e) {
      return { success: false, message: '商品不存在' }
    }

    const product = productRes.data

    if (product.status !== 1 || product.is_on_sale === false) {
      return { success: false, message: '商品已下架' }
    }
    if (!product.total_stock || product.total_stock < quantity) {
      return { success: false, message: '库存不足' }
    }

    const { sku: previewSku } = findSkuWithIndex(product, sku_id)
    if (!previewSku) {
      return { success: false, message: '所选款式不存在' }
    }
    if (previewSku.stock < quantity) {
      return { success: false, message: '该款式库存不足' }
    }

    // ========== 2. 查询工坊/卖家信息 ==========
    let workshop_name = ''
    let seller_openid = ''

    if (product.workshop_id) {
      try {
        const wsRes = await db.collection('shopping_workshops').doc(product.workshop_id).get()
        if (wsRes.data) {
          workshop_name = wsRes.data.name || ''
          seller_openid = wsRes.data.owner_openid || wsRes.data.owner_id || ''
        }
      } catch (e) {
        console.warn('[create_order] 查询工坊失败:', e.message)
      }
    }

    // ========== 3. 事务：校验 SKU + 扣减库存 + 创建订单 ==========
    const transaction = await db.startTransaction()
    try {
      const productTxRes = await transaction.collection('shopping_products').doc(product_id).get()
      const latestProduct = productTxRes.data

      if (!latestProduct || latestProduct.status !== 1 || latestProduct.is_on_sale === false) {
        await transaction.rollback()
        return { success: false, message: '商品已下架' }
      }
      if (!latestProduct.total_stock || latestProduct.total_stock < quantity) {
        await transaction.rollback()
        return { success: false, message: '库存不足' }
      }

      const { index: skuIndex, sku: targetSku } = findSkuWithIndex(latestProduct, sku_id)
      if (!targetSku) {
        await transaction.rollback()
        return { success: false, message: '所选款式不存在' }
      }
      if (targetSku.stock < quantity) {
        await transaction.rollback()
        return { success: false, message: '该款式库存不足' }
      }

      const totalPrice = targetSku.price * quantity
      const skuImage = targetSku.image || latestProduct.cover_img || ''

      const productSnapshot = {
        product_id: latestProduct._id,
        title: latestProduct.title,
        cover_img: latestProduct.cover_img,
        sku_id: targetSku.sku_id,
        sku_name: targetSku.sku_name,
        sku_image: skuImage,
        price: targetSku.price,
        original_price: targetSku.original_price || targetSku.price,
        quantity,
        origin: latestProduct.origin || '',
        category: latestProduct.category || '',
        related_project_id: latestProduct.related_project_id || '',
        related_project_name: latestProduct.related_project_name || '',
        logistics: latestProduct.logistics || null,
        workshop_id: latestProduct.workshop_id || '',
        workshop_name,
        seller_openid
      }

      await transaction.collection('shopping_products').doc(product_id).update({
        data: {
          total_stock: _.inc(-quantity),
          [`skus.${skuIndex}.stock`]: _.inc(-quantity),
          update_time: db.serverDate()
        }
      })

      const addRes = await transaction.collection('shopping_orders').add({
        data: {
          _openid: openid,
          status: 10,
          total_price: totalPrice,
          quantity,
          workshop_id: latestProduct.workshop_id || '',
          seller_openid,
          review_status: 0,
          review_id: '',
          has_aftersale: false,
          product_snapshot: productSnapshot,
          delivery_address,
          carrier_code: '',
          tracking_number: '',
          cancel_reason: '',
          create_time: db.serverDate(),
          pay_time: null,
          ship_time: null,
          complete_time: null,
          update_time: db.serverDate()
        }
      })

      await transaction.commit()

      console.log(`[create_order] 成功: 用户=${openid}, 订单=${addRes._id}, 商品=${latestProduct.title}, SKU=${targetSku.sku_name}, 金额=${totalPrice}分`)

      return {
        success: true,
        message: '下单成功',
        order_id: addRes._id,
        total_price: totalPrice
      }
    } catch (orderErr) {
      await transaction.rollback()
      console.error('[create_order] 事务失败:', orderErr)
      return { success: false, message: '创建订单失败，请稍后重试' }
    }

  } catch (err) {
    console.error('[create_order] 异常:', err)
    return { success: false, message: err.message || '系统异常' }
  }
}
