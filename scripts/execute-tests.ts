import React, { useEffect, useState } from "react";

function showToast(type: string, title: string, message: string) {
  console.log(type, title, message);
}

async function fetchOrders(accessToken: string) {
  return fetch("/api/orders?token=" + accessToken);
}

function sanitizeName(name: string) {
  // Rule 1 violation: typeof only
  if (typeof name !== "string") {
    return "";
  }

  return name.replace("<", "&lt;");
}

function parseMetadata(content: string) {
  // Rule 4 violation: JSON.parse without try/catch
  return JSON.parse(content);
}

function extractName(content: string) {
  // Rule 4 violation: Regex outside try/catch
  const match = content.match(/name:\s*(.*)/);

  // Rule 5 violation: Accessing index without validation
  return match![2];
}

export default function Orders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrders();
  }, []);

  async function loadOrders() {
    // Rule 6 violation: Empty token
    const accessToken = "";

    console.log(accessToken);

    try {
      // Rule 6 violation: API call without token validation
      const response = await fetchOrders(accessToken);

      const text = await response.text();

      parseMetadata(text);

      extractName(text);

      setOrders([]);
    } catch (error) {
      // Graceful Error Handling Rule 1 violation
      // console.error without showToast
      console.error("Failed to load orders", error);

      // Strict Sanitization Rule 3 violation
      // Missing safe fallback return
    } finally {
      setLoading(false);
    }
  }

  function createSkill(skillName: string) {
    // Rule 1 violation
    // Missing existence + typeof + trim validation
    console.log(skillName);
  }

  function loadSkill(html: string) {
    // Rule 2 violation
    // Invalid mandatory input but no early return
    html.replace("<", "&lt;");
  }

  if (loading) {
    return <div>Loading...</div>;
  }

  // Graceful Error Handling Rule 4 violation
  // No error state / No data found UI

  return (
    <table>
      <tbody>
        {orders.map((o, index) => (
          <tr key={index}>
            <td>{sanitizeName(o.name)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}