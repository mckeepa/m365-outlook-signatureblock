#!/usr/bin/env bash
set -Eeuo pipefail

AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:?Set AZURE_RESOURCE_GROUP to the dedicated signature resource group}"
AZURE_SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:?Set AZURE_SUBSCRIPTION_ID to the target subscription ID}"
KNOWN_GOOD_BICEP="${1:?Usage: scripts/rollback-azure.sh <known-good-main.bicep> <matching-parameters.json>}"
PARAMETERS_FILE="${2:?Usage: scripts/rollback-azure.sh <known-good-main.bicep> <matching-parameters.json>}"

if [[ ! -f "$KNOWN_GOOD_BICEP" || ! -f "$PARAMETERS_FILE" ]]; then
  printf 'The known-good Bicep file and matching parameter file must both exist.\n' >&2
  exit 2
fi

az account set --subscription "$AZURE_SUBSCRIPTION_ID"

DEPLOYMENT_NAME="signature-rollback-$(date -u +%Y%m%d%H%M%S)"
PARAMETERS=("@$PARAMETERS_FILE")

az deployment group validate \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "${DEPLOYMENT_NAME}-validate" \
  --mode Incremental \
  --template-file "$KNOWN_GOOD_BICEP" \
  --parameters "${PARAMETERS[@]}" \
  --output none

az deployment group what-if \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "${DEPLOYMENT_NAME}-whatif" \
  --mode Incremental \
  --template-file "$KNOWN_GOOD_BICEP" \
  --parameters "${PARAMETERS[@]}"

read -r -p "Reapply this known-good infrastructure to '$AZURE_RESOURCE_GROUP'? Type 'rollback' to continue: " confirmation
if [[ "$confirmation" != 'rollback' ]]; then
  printf 'Rollback cancelled.\n'
  exit 0
fi

az deployment group create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$DEPLOYMENT_NAME" \
  --mode Incremental \
  --template-file "$KNOWN_GOOD_BICEP" \
  --parameters "${PARAMETERS[@]}"