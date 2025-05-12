from locust import HttpUser, task, between
import json
import random
import subprocess
import os

class HomeChanceUser(HttpUser):
    wait_time = between(1, 5)

    def on_start(self):
        self.user_id = f"testuser{random.randint(1000, 9999)}"
        self.raffle_id = "raffle_001"
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer <your-jwt-token-here>"  # Replace with actual token
        }

    def sign_transaction(self, user_id):
        try:
            result = subprocess.run(
                ["node", "sign_transaction.js", user_id],
                capture_output=True,
                text=True,
                check=True
            )
            data = json.loads(result.stdout)
            return data["publicKey"], data["signature"]
        except subprocess.CalledProcessError as e:
            self.environment.events.request_failure.fire(
                request_type="SignTransaction",
                name="sign_transaction",
                response_time=0,
                exception=Exception(f"Signing failed: {e.stderr}")
            )
            return None, None

    @task
    def purchase_ticket(self):
        user_wallet, signature = self.sign_transaction(self.user_id)
        if not user_wallet or not signature:
            return

        payload = {
            "raffleId": self.raffle_id,
            "userWallet": user_wallet,
            "userId": self.user_id,
            "ticketCount": 1,
            "signature": signature
        }

        with self.client.post(
            "/api/purchase-ticket",
            data=json.dumps(payload),
            headers=self.headers,
            name="/api/purchase-ticket"
        ) as response:
            if response.status_code == 200:
                self.environment.events.request_success.fire(
                    request_type="POST",
                    name="/api/purchase-ticket",
                    response_time=response.elapsed.total_seconds() * 1000,
                    response_length=len(response.text)
                )
            else:
                self.environment.events.request_failure.fire(
                    request_type="POST",
                    name="/api/purchase-ticket",
                    response_time=response.elapsed.total_seconds() * 1000,
                    exception=Exception(f"Status code: {response.status_code}, Text: {response.text}")
                )

    @task(2)
    def check_raffle_status(self):
        with self.client.get(
            f"/api/raffle-status/{self.raffle_id}",
            headers=self.headers,
            name="/api/raffle-status/:raffleId"
        ) as response:
            if response.status_code == 200:
                self.environment.events.request_success.fire(
                    request_type="GET",
                    name="/api/raffle-status/:raffleId",
                    response_time=response.elapsed.total_seconds() * 1000,
                    response_length=len(response.text)
                )
            else:
                self.environment.events.request_failure.fire(
                    request_type="GET",
                    name="/api/raffle-status/:raffleId",
                    response_time=response.elapsed.total_seconds() * 1000,
                    exception=Exception(f"Status code: {response.status_code}, Text: {response.text}")
                )

    @task(1)
    def cancel_raffle(self):
        with self.client.post(
            "/api/cancel-raffle",
            data=json.dumps({ "raffleId": self.raffle_id }),
            headers=self.headers,
            name="/api/cancel-raffle"
        ) as response:
            if response.status_code == 200:
                self.environment.events.request_success.fire(
                    request_type="POST",
                    name="/api/cancel-raffle",
                    response_time=response.elapsed.total_seconds() * 1000,
                    response_length=len(response.text)
                )
            else:
                self.environment.events.request_failure.fire(
                    request_type="POST",
                    name="/api/cancel-raffle",
                    response_time=response.elapsed.total_seconds() * 1000,
                    exception=Exception(f"Status code: {response.status_code}, Text: {response.text}")
                )