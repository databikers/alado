export const defaultOpenApiDocObject: any = {
  openapi: '3.0.0',
  info: {
    title: '',
    version: '1.0.0',
    description: ''
  },
  servers: [],
  paths: {},
  components: {
    schemas: {
      Error: {
        properties: {
          message: {
            type: 'string'
          }
        }
      }
    },
    securitySchemes: {},
    responses: {
      '204': {
        description: 'No content'
      },
      '401': {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
          },
        },
      },
      '402': {
        description: 'Payment required',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
          },
        },
      },
      '403': {
        description: 'Forbidden',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
          },
        },
      },
      '404': {
        description: 'Not Found',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
          },
        },
      },
      '405': {
        description: 'Method Not Allowed',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
          },
        },
      },
      '409': {
        description: 'Conflict',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
          },
        },
      },
      '413': {
        description: 'Request entity too large',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
          },
        },
      },
      '429': {
        description: 'Too many requests',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
          },
        },
      },
      '451': {
        description: 'Unavailable For Legal Reasons',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
          },
        },
      }
    },
  },
  security: []
}
