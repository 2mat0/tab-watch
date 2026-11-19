const destination = document.querySelector("#destination");
const deliveryMethod = document.querySelector("#delivery-method");
const deliveryRecipient = document.querySelector("#delivery-recipient");
const deliveryAddress = document.querySelector("#delivery-address");
const deliveryCity = document.querySelector("#delivery-city");
const demoStatus = document.querySelector("#demo-status");
const orderStatus = document.querySelector("#order-status");
let changeQueued = false;

document.querySelector("#queue-change").addEventListener("click", () => {
  if (destination.dataset.method === "locker") {
    demoStatus.textContent = "Reset the checkout to replay the delivery change.";
    return;
  }
  changeQueued = true;
  demoStatus.textContent = "Last action · Delivery change queued.";
});

document.querySelector("#reset-demo").addEventListener("click", () => location.reload());

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || !changeQueued) return;
  changeQueued = false;
  destination.dataset.method = "locker";
  deliveryMethod.textContent = "Locker pickup";
  deliveryRecipient.textContent = "Summit Parcel Locker 04";
  deliveryAddress.textContent = "680 Granite Avenue";
  deliveryCity.textContent = "Westhaven, WA";
});

document.querySelector("#place-order").addEventListener("click", () => {
  orderStatus.hidden = false;
  orderStatus.textContent = `Simulated order confirmed for ${deliveryAddress.textContent}, ${deliveryCity.textContent}.`;
});
