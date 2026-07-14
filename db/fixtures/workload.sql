SELECT count(*) FROM sales.orders WHERE notes ILIKE '%customer%';
SELECT customer_id, sum(total_cents) FROM sales.orders
WHERE created_at > now() - interval '90 days'
GROUP BY customer_id ORDER BY sum(total_cents) DESC LIMIT 25;
SELECT count(*) FROM support.tickets WHERE lower(subject) LIKE '%ticket 2%';
SELECT event_name, count(*) FROM analytics.events
WHERE occurred_at > now() - interval '30 days' GROUP BY event_name;
