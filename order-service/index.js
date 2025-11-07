import express from 'express';
import axios from 'axios';
import db from './db.js';
import { connectToBroker, publishMessage } from './broker.js';

const app = express();
app.use(express.json());

// RabbitMQ
connectToBroker().catch(error => console.error('Broker init error', error));

// Create order
app.post('/', async (req, res) => {
  // TODO: Implement order creation with the following steps:
  // 1. Validate request body:
  try {
    const { productId, quantity } = req.body;

    if (!productId || !quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Invalid productId or quantity' });
    }

    // 2. Call product service to verify product exists:
    const PRODUCT_URL = `http://product-service:8002/${productId}`;
    let product;
    try {
      const response = await axios.get(PRODUCT_URL, { timeout: 2000 });
      product = response.data;
    } catch (error) {
      console.error('Product check error:', error.message);
      return res.status(404).json({ error: 'Product not found' });
    }
    // 3. Insert order into database:
    const insert = await db.query(
      'INSERT INTO orders (product_id, quantity, status, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [productId, quantity, 'PENDING']
    );
    const order = insert.rows[0];
    // 4. Publish order.created event to message broker:
    const event = {
      event: 'ORDER_CREATED',
      orderId: order.id,
      product: {
        id: product.id,
        title: product.title,
        author: product.author,
        price: product.price,
      },
      quantity,
    };

    try {
      await publishMessage('order.created', event);
      console.log('Published event:', event);
    } catch (error) {
      console.error('Failed to publish event:', error.message);
    }
    // 5. Return success response with order details
    res.status(201).json({
      message: 'Order created successfully',
      order,
    });
  } catch (error) {
    console.error("Order creation error:", error);
    res.status(500).json({ message: error.message });
  }
});

// List orders
app.get('/', async (_req, res) => {
  const r = await db.query('SELECT * FROM orders ORDER BY id DESC');
  res.json(r.rows);
});

// Get order by id
app.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
  res.json(r.rows[0]);
});

const PORT = 8003;
app.listen(PORT, () => console.log(`Order Service running on ${PORT}`));
