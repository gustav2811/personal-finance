"""Minimal ISMRT / RMS Connect API client.

Auth: Keycloak password grant (realm `rms`, client `ismrt-dashboard`).
API: GraphQL at https://api-gateway.rmsconnect.net/graphql

Credentials are read from environment variables only:
  ISMRT_USERNAME
  ISMRT_PASSWORD
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

TOKEN_URL = (
    "https://account.rmsconnect.net/auth/realms/rms/protocol/openid-connect/token"
)
GRAPHQL_URL = "https://api-gateway.rmsconnect.net/graphql"
CLIENT_ID = "ismrt-dashboard"


class IsmrtError(RuntimeError):
    pass


@dataclass(frozen=True)
class IsmrtCredentials:
    username: str
    password: str

    @classmethod
    def from_env(cls) -> IsmrtCredentials:
        username = os.environ.get("ISMRT_USERNAME", "").strip()
        password = os.environ.get("ISMRT_PASSWORD", "").strip()
        if not username or not password:
            raise IsmrtError(
                "Set ISMRT_USERNAME and ISMRT_PASSWORD in your environment before running."
            )
        return cls(username=username, password=password)


class IsmrtClient:
    def __init__(self, creds: IsmrtCredentials, *, timeout: float = 60.0) -> None:
        self._creds = creds
        self._timeout = timeout
        self._access_token: str | None = None

    def authenticate(self) -> dict[str, Any]:
        with httpx.Client(timeout=self._timeout) as client:
            response = client.post(
                TOKEN_URL,
                data={
                    "client_id": CLIENT_ID,
                    "grant_type": "password",
                    "username": self._creds.username,
                    "password": self._creds.password,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if response.status_code != 200:
            raise IsmrtError(f"Token request failed ({response.status_code}): {response.text}")
        payload = response.json()
        token = payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise IsmrtError(f"Token response missing access_token: {payload}")
        self._access_token = token
        return {
            "token_type": payload.get("token_type"),
            "expires_in": payload.get("expires_in"),
            "refresh_token_present": bool(payload.get("refresh_token")),
        }

    def graphql(
        self,
        query: str,
        variables: dict[str, Any] | None = None,
        *,
        operation_name: str | None = None,
    ) -> dict[str, Any]:
        if not self._access_token:
            raise IsmrtError("Call authenticate() first.")
        body: dict[str, Any] = {"query": query}
        if variables is not None:
            body["variables"] = variables
        if operation_name:
            body["operationName"] = operation_name
        with httpx.Client(timeout=self._timeout) as client:
            response = client.post(
                GRAPHQL_URL,
                json=body,
                headers={
                    # RMS GraphQL reads this custom header. The Keycloak
                    # Authorization header alone is accepted by the gateway
                    # but is not forwarded to the GraphQL authorizer.
                    "x-access-token": self._access_token,
                    "Content-Type": "application/json",
                },
            )
        if response.status_code != 200:
            raise IsmrtError(f"GraphQL HTTP {response.status_code}: {response.text}")
        payload = response.json()
        if payload.get("errors"):
            raise IsmrtError(f"GraphQL errors: {json.dumps(payload['errors'], indent=2)}")
        data = payload.get("data")
        if not isinstance(data, dict):
            raise IsmrtError(f"GraphQL response missing data: {payload}")
        return data

    def list_wallets(self) -> list[dict[str, Any]]:
        query = """
        query UserWallets {
          userWallets {
            nodes {
              id
              propertyId
              premiseName
              propertyName
              accountReference
              startDate
              endDate
              balance
              isActive
              minimumBalance
              depositAmount
              isWalletOwner
              idPrepaidContactWallet
            }
          }
        }
        """
        data = self.graphql(query, operation_name="UserWallets")
        nodes = data.get("userWallets", {}).get("nodes", [])
        if not isinstance(nodes, list):
            raise IsmrtError(f"Unexpected userWallets shape: {data}")
        return nodes

    def wallet_utility_transactions(
        self,
        wallet_id: str,
        utility_type: str,
        start: datetime,
        end: datetime,
    ) -> list[dict[str, Any]]:
        query = """
        query WalletUtilityTransactions(
          $id: ID!
          $utilityType: String!
          $startDate: DateTime!
          $endDate: DateTime!
        ) {
          walletUtilityTransactions(
            id: $id
            utilityType: $utilityType
            startDate: $startDate
            endDate: $endDate
          ) {
            nodes {
              debit
              credit
              date
              charge
              consumption
              rate
              meterSerial
            }
          }
        }
        """
        variables = {
            "id": wallet_id,
            "utilityType": utility_type,
            "startDate": _iso_z(start),
            "endDate": _iso_z(end),
        }
        data = self.graphql(
            query,
            variables=variables,
            operation_name="WalletUtilityTransactions",
        )
        nodes = data.get("walletUtilityTransactions", {}).get("nodes", [])
        if not isinstance(nodes, list):
            raise IsmrtError(f"Unexpected walletUtilityTransactions shape: {data}")
        return nodes

    def wallet_expense_transactions(
        self,
        wallet_id: str,
        start: datetime,
        end: datetime,
    ) -> list[dict[str, Any]]:
        query = """
        query WalletExpenseTransactions(
          $id: ID!
          $startDate: DateTime!
          $endDate: DateTime!
        ) {
          walletExpenseTransactions(
            id: $id
            startDate: $startDate
            endDate: $endDate
          ) {
            nodes {
              utilityType
              charge
              debit
              credit
              rate
              date
              meterSerial
              consumption
              reference
            }
          }
        }
        """
        variables = {
            "id": wallet_id,
            "startDate": _iso_z(start),
            "endDate": _iso_z(end),
        }
        data = self.graphql(
            query,
            variables=variables,
            operation_name="WalletExpenseTransactions",
        )
        nodes = data.get("walletExpenseTransactions", {}).get("nodes", [])
        if not isinstance(nodes, list):
            raise IsmrtError(f"Unexpected walletExpenseTransactions shape: {data}")
        return nodes

    def wallet_detail(
        self,
        wallet_id: str,
        start: datetime,
        end: datetime,
    ) -> dict[str, Any]:
        query = """
        query WalletDetail($id: ID!, $startDate: DateTime!, $endDate: DateTime!) {
          wallet(id: $id) {
            consolidatedTransactions(startDate: $startDate, endDate: $endDate) {
              nodes {
                utilityType
                debit
                credit
                date
              }
            }
            contracts {
              nodes {
                code
                billingFrequency
                service {
                  meters {
                    nodes {
                      id
                      serial
                    }
                  }
                }
              }
            }
          }
        }
        """
        variables = {
            "id": wallet_id,
            "startDate": _iso_z(start),
            "endDate": _iso_z(end),
        }
        data = self.graphql(query, variables=variables, operation_name="WalletDetail")
        wallet = data.get("wallet")
        if not isinstance(wallet, dict):
            raise IsmrtError(f"Unexpected wallet shape: {data}")
        return wallet

    def wallet_invoices(
        self,
        wallet_id: str,
        start: datetime,
        end: datetime,
    ) -> list[dict[str, Any]]:
        query = """
        query WalletInvoices($id: ID!, $startDate: DateTime!, $endDate: DateTime!) {
          walletInvoices(id: $id, startDate: $startDate, endDate: $endDate) {
            nodes {
              idKey
              documentNumber
              documentDate
              total
            }
          }
        }
        """
        variables = {
            "id": wallet_id,
            "startDate": _iso_z(start),
            "endDate": _iso_z(end),
        }
        data = self.graphql(query, variables, operation_name="WalletInvoices")
        nodes = data.get("walletInvoices", {}).get("nodes", [])
        if not isinstance(nodes, list):
            raise IsmrtError(f"Unexpected walletInvoices shape: {data}")
        return nodes

    def wallet_proof_of_payments(
        self,
        wallet_id: str,
        start: datetime,
        end: datetime,
    ) -> list[dict[str, Any]]:
        query = """
        query WalletProofOfPayments(
          $id: ID!
          $startDate: DateTime!
          $endDate: DateTime!
        ) {
          walletProofOfPayments(id: $id, startDate: $startDate, endDate: $endDate) {
            nodes {
              idKey
              documentNumber
              documentDate
              total
            }
          }
        }
        """
        variables = {
            "id": wallet_id,
            "startDate": _iso_z(start),
            "endDate": _iso_z(end),
        }
        data = self.graphql(
            query,
            variables,
            operation_name="WalletProofOfPayments",
        )
        nodes = data.get("walletProofOfPayments", {}).get("nodes", [])
        if not isinstance(nodes, list):
            raise IsmrtError(f"Unexpected walletProofOfPayments shape: {data}")
        return nodes

    def meter_profile(
        self,
        serial: str,
        start: datetime,
        end: datetime,
        interval: str = "Daily",
    ) -> Any:
        query = """
        query MeterProfile(
          $serial: String!
          $startDate: DateTime!
          $endDate: DateTime!
          $interval: String!
        ) {
          meterProfile(
            serial: $serial
            startDate: $startDate
            endDate: $endDate
            interval: $interval
          )
        }
        """
        variables = {
            "serial": serial,
            "startDate": _iso_z(start),
            "endDate": _iso_z(end),
            "interval": interval,
        }
        data = self.graphql(query, variables=variables, operation_name="MeterProfile")
        return data.get("meterProfile")


def _iso_z(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def default_date_range(days: int = 90) -> tuple[datetime, datetime]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    return start, end
