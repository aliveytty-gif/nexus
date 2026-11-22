ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
COPY --chown=node:node gateway.mjs ./gateway.mjs
USER node
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "gateway.mjs"]
