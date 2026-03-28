const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const productId = typeof event.product_id === 'string' ? event.product_id.trim() : ''
  if (!productId) {
    return {
      success: false,
      message: '缺少 product_id'
    }
  }

  try {
    await db.collection('shopping_products').doc(productId).update({
      data: {
        view_count: _.inc(1),
        update_time: db.serverDate()
      }
    })

    return {
      success: true
    }
  } catch (err) {
    console.error('[report_product_view]', err)
    return {
      success: false,
      message: err.message || '上报浏览失败'
    }
  }
}
