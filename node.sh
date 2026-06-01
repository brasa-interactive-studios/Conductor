# Instalar NVM
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Recarregar terminal
source ~/.bashrc

# Instalar última versão LTS do Node
nvm install --lts

# Usar ela como padrão
nvm use --lts
nvm alias default lts/*

# Verificar
node -v
npm -v
