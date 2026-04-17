import { Context, RequestAuthentication } from '@dto';
import { getProperty, setProperty } from '../accessor';

export async function authenticate(context: Context<any>, request: any): Promise<any> {
  const { auth } = context;
  const { required, handler, handlerContext, inputProperty, outputProperty, error } = auth as RequestAuthentication;

  const authData: any = getProperty(request, inputProperty);
  if (required && !authData) {
    return error;
  }
  try {
    const result = await handler.apply(handlerContext || {}, [authData]);
    if (!result) {
      return error;
    }
    setProperty(request, outputProperty, result);
  } catch (e: any) {
    return {
      statusCode: error.statusCode,
      message: e.message,
    };
  }
}
