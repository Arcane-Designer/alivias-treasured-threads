/*
 * ============================================
 * ALIVIA'S TREASURED THREADS — PRODUCT DATA
 * ============================================
 *
 * HOW TO UPDATE PRODUCTS:
 *
 * 1. To ADD a new product type:
 *    - Add a new object to the PRODUCTS array below
 *    - Include: id, name, price, priceLabel, description, images[], availableItems[]
 *
 * 2. To ADD a new "ready to ship" item:
 *    - Find the product type in PRODUCTS
 *    - Add a new object to its availableItems[] array
 *    - Include: id, name, image
 *
 * 3. To REMOVE a sold item:
 *    - Find the item in availableItems[] and delete or comment out that object
 *
 * 4. To UPDATE a price:
 *    - Change the "price" and/or "priceLabel" field
 *
 * 5. Image paths are relative to the site root (images/products/ or images/available/)
 * ============================================
 */

const PRODUCTS = [
  {
    id: "hooded-cape",
    name: "Hooded Cape",
    price: null,
    priceLabel: "Custom Order",
    description: "Handmade hooded capes — perfect for costumes, festivals, or just feeling magical. Each cape is custom-sewn to order in the fabric of your choice.",
    images: [
      "images/products/cape-1.jpg",
      "images/products/cape-2.jpg"
    ],
    availableItems: [
      // No pre-made capes currently — all custom order
    ]
  },
  {
    id: "bookmarks",
    name: "Bookmarks",
    price: 4,
    priceLabel: "$4 each or 2 for $6",
    description: "Handmade fabric bookmarks in tons of fun patterns. Also available as corner bookmarks! Perfect little gifts for the book lover in your life.",
    images: [
      "images/products/bookmarks-1.jpg",
      "images/products/bookmarks-2.jpg"
    ],
    availableItems: [
      { id: "bk-fall-fun", name: "Fall Fun Bookmark", image: "images/available/bookmark-fall-fun.jpg" },
      { id: "bk-fall-fun-2", name: "Fall Fun Bookmark #2", image: "images/available/bookmark-fall-fun-2.jpg" },
      { id: "bk-fall-pattern", name: "Fall Pattern Bookmark", image: "images/available/bookmark-fall-pattern.jpg" },
      { id: "bk-black", name: "Black Bookmark", image: "images/available/bookmark-black.jpg" },
      { id: "bk-blue-green", name: "Blue & Green Pattern Bookmark", image: "images/available/bookmark-blue-and-green-pattern.jpg" },
      { id: "bk-brown-fb", name: "Brown Bookmark (Front & Back)", image: "images/available/bookmark-brown-front-and-back.jpg" },
      { id: "bk-brown-green", name: "Brown & Green Bookmark", image: "images/available/bookmark-brown-and-green.jpg" },
      { id: "bk-green-fb", name: "Green Bookmark (Front & Back)", image: "images/available/bookmark-green-front-and-back.jpg" },
      { id: "bk-greenery-flowers", name: "Greenery Flowers Bookmark", image: "images/available/bookmark-greenery-flowers.jpg" },
      { id: "bk-greenery-pattern", name: "Greenery Pattern Bookmark", image: "images/available/bookmark-greenery-pattern.jpg" },
      { id: "bk-orange-black", name: "Orange & Black Bookmark", image: "images/available/bookmark-orange-and-black.jpg" },
      { id: "bk-pink", name: "Pink Bookmark", image: "images/available/bookmark-pink.jpg" },
      { id: "bk-space-black", name: "Space Black Bookmark", image: "images/available/bookmark-space-black.jpg" },
      { id: "bk-space-man", name: "Space Man Bookmark", image: "images/available/bookmark-space-man.jpg" },
      { id: "cbk-fall-fun", name: "Corner Bookmark - Fall Fun", image: "images/available/corner-bookmark-fall-fun.jpg" },
      { id: "cbk-green", name: "Corner Bookmark - Green", image: "images/available/corner-bookmark-green.jpg" },
      { id: "cbk-pink-crystal", name: "Corner Bookmark - Pink Crystal", image: "images/available/corner-bookmark-pink-crystal.jpg" }
    ]
  },
  {
    id: "zipper-pouch",
    name: "Zipper Pouch",
    price: 9,
    priceLabel: "$9",
    description: "A cute and handy zipper pouch — great for makeup, school supplies, sewing notions, or whatever you need to keep organized!",
    images: [
      "images/products/makeup-bag.jpg"
    ],
    availableItems: [
      { id: "zp-fall", name: "Fall Pattern Zipper Pouch", image: "images/available/makeup-bag-fall-pattern.jpg" }
    ]
  },
  {
    id: "heart-bag",
    name: "Heart Bag",
    price: 19,
    priceLabel: "$19",
    description: "An adorable heart-shaped bag — a fun and unique accessory that's sure to get compliments!",
    images: [
      // Heart bag visible in product catalog images
      "images/products/products-4.jpg"
    ],
    availableItems: []
  },
  {
    id: "messenger-bag",
    name: "Messenger Side Bag",
    price: 29,
    priceLabel: "$29",
    description: "A practical and stylish messenger side bag with roomy interior and adjustable strap. Perfect for everyday use!",
    images: [
      "images/products/products-4.jpg"
    ],
    availableItems: []
  },
  {
    id: "annas-everyday-tote",
    name: "Anna's Everyday Tote Bag",
    price: null,
    priceLabel: "Custom Order",
    description: "A beautifully patchwork tote bag — roomy enough for everyday errands, cute enough to show off. Each one is unique!",
    images: [
      "images/products/anna-s-everyday-tote-bag-1.jpg",
      "images/products/anna-s-everyday-tote-bag-2.jpg",
      "images/products/anna-s-everyday-tote-bag-3.jpg",
      "images/products/anna-s-everyday-tote-bag-4.jpg",
      "images/products/products-1.jpg",
      "images/products/products-3.jpg"
    ],
    availableItems: [
      { id: "tote-black-halloween", name: "Black Halloween Tote", image: "images/available/anna-s-everyday-tote-bag-black-halloween.jpg" },
      { id: "tote-orange-halloween", name: "Orange Halloween Tote", image: "images/available/anna-s-everyday-tote-bag-orange-halloween.jpg" }
    ]
  },
  {
    id: "annas-overnighter-tote",
    name: "Anna's Overnighter Tote Bag",
    price: null,
    priceLabel: "Custom Order",
    description: "The big sister of the Everyday Tote — extra roomy for overnights, beach days, or anytime you need to pack more!",
    images: [
      "images/products/anna-s-overnighter-tote-bag-1.jpg",
      "images/products/anna-s-overnighter-tote-bag-2.jpg",
      "images/products/products-2.jpg"
    ],
    availableItems: []
  },
  {
    id: "pot-holders",
    name: "Pot Holders",
    price: null,
    priceLabel: "Custom Order",
    description: "Handmade quilted pot holders — functional and adorable! Available in all sorts of fun fabrics.",
    images: [
      "images/products/pot-holders-1.jpg",
      "images/products/pot-holders-2.jpg",
      "images/products/pot-holders-3.jpg"
    ],
    availableItems: [
      { id: "ph-black-halloween", name: "Black Halloween Pot Holder", image: "images/available/pot-holder-black-halloween.jpg" },
      { id: "ph-orange-halloween", name: "Orange Halloween Pot Holder", image: "images/available/pot-holder-orange-halloween.jpg" }
    ]
  },
  {
    id: "sewing-roll",
    name: "Sewing Roll",
    price: 24,
    priceLabel: "$24",
    description: "A roll-up sewing organizer with pockets for needles, pins, scissors, and more. Ties shut with yarn and rolls up compact for storage or travel.",
    images: [
      "images/products/pencil-brush-roll-1.jpg",
      "images/products/pencil-brush-roll-2.jpg"
    ],
    availableItems: []
  },
  {
    id: "craft-roll",
    name: "Craft Roll",
    price: 19,
    priceLabel: "$19",
    description: "Like the Sewing Roll but made for markers, colored pencils, crochet hooks, or paint brushes. Rolls up with a yarn tie — super portable!",
    images: [
      "images/products/pencil-brush-roll-3.jpg",
      "images/products/pencil-brush-roll-4.jpg"
    ],
    availableItems: []
  }
];

/*
 * SITE SETTINGS
 * Update these values as needed
 */
const SITE_SETTINGS = {
  /* Email where form submissions are sent — UPDATE THIS */
  contactEmail: "aliviagellatly@gmail.com",

  /* Instagram URL */
  instagramUrl: "https://www.instagram.com/alivias_treasured_threads?igsh=ajdiMWM4ajBtaHBn",

  /* Web3Forms access key */
  web3formsKey: "83bacc95-b2fb-42fc-861e-3c16f4104ac2",

  /* Brand name */
  brandName: "Alivia's Treasured Threads",

  /* Tagline */
  tagline: "Handmade with love, one stitch at a time"
};
