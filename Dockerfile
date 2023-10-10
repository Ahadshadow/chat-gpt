FROM node:16-alpine

# Create a non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /home/node/app

# Copy package.json and package-lock.json first to leverage caching
COPY package*.json ./
COPY .env .

# Install dependencies
# RUN npm cache clean --force
RUN npm install 

# Copy the rest of the application files
COPY . .

# Change ownership of the whole directory to the non-root user
RUN chown -R appuser:appgroup /home/node/app

# RUN chown appuser:appgroup /home/node/app/.nuxt/nuxt.json

RUN chmod -R 777 /home/node/app/.nuxt


EXPOSE 3000 24678

# RUN chown -R node:node /home/node/app

# Run the application with the non-root user
USER appuser


# RUN chown -R node:node /home/node/app/.nuxt

# RUN chown -R node:node /home/node/app/node_modules

# RUN chown node:node nuxt.config.js && chmod 777 nuxt.config.js

CMD ["npm", "run", "dev"]
