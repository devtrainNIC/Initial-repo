#!/bin/bash
# Builds a Lambda deployment package with dependencies
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
PACKAGE_DIR="$BUILD_DIR/package"

echo "Cleaning previous build..."
rm -rf "$BUILD_DIR"
mkdir -p "$PACKAGE_DIR"

echo "Installing dependencies..."
pip install -r "$SCRIPT_DIR/requirements.txt" --target "$PACKAGE_DIR" --quiet

echo "Copying Lambda source..."
cp "$SCRIPT_DIR/lambda_function.py" "$PACKAGE_DIR/"

echo "Creating deployment zip..."
cd "$PACKAGE_DIR"
zip -r "$BUILD_DIR/lambda_deployment.zip" . -q

echo "Done: $BUILD_DIR/lambda_deployment.zip"
