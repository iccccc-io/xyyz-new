const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async () => {
  return {
    success: false,
    message: '旧版单规格商品发布接口已停用，请改用 manage_shopping_product 并传入 skus[]。'
  }
}
