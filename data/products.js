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
 *    - Include: id, name, image, (optional) images[] for multiple photos
 *
 * 3. To REMOVE a sold item:
 *    - Find the item in availableItems[] and delete or comment out that object
 *
 * 4. To UPDATE a price:
 *    - Change the "price" and/or "priceLabel" field
 *
 * 5. Image paths are relative to the site root (images/products/ or images/available/)
 *
 * 6. Optional fields on products:
 *    - badge: a small text badge shown on the product card (e.g. "Now available in mini!")
 *
 * 7. REMOVING A SOLD ITEM:
 *    - When Alivia sells a ready-to-ship item, just delete that item's object
 *      from the availableItems[] array of the relevant product below
 *    - If ALL available items for a product are sold, the "In Stock!" badge
 *      will automatically disappear from the product card
 * ============================================
 */

const PRODUCTS = [
  {
    id: "hooded-cape",
    name: "Hooded Cape",
    price: null,
    priceLabel: "Custom Order",
    description: "Handcrafted hooded capes. Ideal for costumes, festivals, or just everyday whimsy. Capes are by custom order only to make sure it's perfect for you.",
    images: [
      "images/products/cape-1.jpg",
      "images/products/cape-2.jpg"
    ],
    availableItems: []
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
      { id: "bk-fall-pattern", name: "Fall Fun Bookmark #3", image: "images/available/bookmark-fall-pattern.jpg" },
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
    price: 14,
    priceLabel: "$14",
    badge: "Now available in mini!",
    description: "A cute and handy zipper pouch. Great for makeup, school supplies, sewing notions, or whatever you need to keep organized!",
    images: [
      "images/products/makeup-bag.jpg"
    ],
    availableItems: [
      { id: "zp-fall", name: "Fall Pattern Zipper Pouch", image: "images/available/fall-pattern-zipper-pouch.jpg" },
      { id: "zp-mushroom", name: "Keene's Mushroom Zipper Pouch", image: "images/available/keenes-mushroom-zipper-pouch.jpg" }
    ]
  },
  {
    id: "mini-zipper-pouch",
    name: "Mini Zipper Pouch",
    price: 7,
    priceLabel: "$7",
    description: "A tiny version of our zipper pouch, perfect for coins, earbuds, small treasures, or whatever fits. 3\" x 3\" x 0.5\". This mini size was born from a special collaboration with Keene, a cryptid (Sasquatch) with his own Instagram. Custom order yours in any fabric!",
    descriptionLink: { text: "Meet Keene on Instagram", url: "https://www.instagram.com/not_too_keene?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==" },
    images: [
      "images/products/mini-zipper-pouch-1.jpg",
      "images/products/mini-zipper-pouch-2.jpg",
      "images/products/mini-zipper-pouch-3.jpg",
      "images/products/mini-zipper-pouch-4.jpg"
    ],
    availableItems: []
  },
  {
    id: "cute-quilted-coasters",
    name: "Cute Quilted Coasters",
    price: 4,
    priceLabel: "$4 for one or $12 for 4",
    description: "Cute quilted coasters! These coasters are perfect for everyday use, they're machine washable and can catch little drips. Buy just one or buy a whole set!",
    images: [
      "images/products/cute-quilted-coaster-1.jpg"
    ],
    availableItems: [
      { id: "coaster-pink", name: "Pretty in Pink Coaster", image: "images/available/pretty-in-pink-coaster.jpg" },
      { id: "coaster-papaya-racing", name: "Papaya Racing Coaster", image: "images/available/papaya-racing-coaster.jpg" }
    ]
  },
  {
    id: "annas-everyday-tote",
    name: "Anna's Everyday Tote Bag",
    price: 35,
    priceLabel: "$35",
    description: "A beautiful patchwork tote. It's roomy enough for everyday errands and cute enough to show off!",
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
    id: "overnighter-tote",
    name: "Overnighter Tote Bag",
    price: 50,
    priceLabel: "$50",
    description: "The big sister of the Everyday Tote. This bag is extra roomy for overnights, beach days, or anytime you need to pack more!",
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
    price: 8,
    priceLabel: "$8",
    description: "Handmade quilted pot holders. They're functional and adorable! Available in all sorts of fun fabrics.",
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
    id: "craft-roll",
    name: "Craft Roll",
    price: 19,
    priceLabel: "$19",
    description: "A roll-up organizer for brushes, pens, markers, or other craft tools. Rolls up compactly with a yarn or ribbon tie.",
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
  /* Email where form submissions are sent */
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
